const express = require('express');
const router = express.Router();
const { validateEvent, WebhookVerificationError } = require('@polar-sh/sdk/webhooks');
const { supabaseAdmin } = require('../../config/supabase');

/**
 * POST /api/webhooks/polar
 * Polar webhook events handler
 * 
 * IMPORTANT: This route must use express.raw() middleware
 * for signature verification to work correctly
 */
router.post('/polar', express.raw({ type: 'application/json' }), async (req, res) => {
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('🔔 POLAR WEBHOOK RECEIVED');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('Timestamp:', new Date().toISOString());

  try {
    // Webhook signature validation
    const event = validateEvent(
      req.body,
      req.headers,
      process.env.POLAR_WEBHOOK_SECRET || 'webhook_secret_placeholder'
    );

    console.log('✅ Webhook signature validated');
    console.log('📦 Event type:', event.type);
    console.log('📦 Event ID:', event.id || 'N/A');

    // Event handling
    switch (event.type) {
      case 'order.created':
        await handleOrderCreated(event.data);
        break;
        
      case 'order.updated':
        await handleOrderUpdated(event.data);
        break;
        
      case 'checkout.created':
        await handleCheckoutCreated(event.data);
        break;
        
      case 'checkout.updated':
        await handleCheckoutUpdated(event.data);
        break;
        
      case 'subscription.created':
        await handleSubscriptionCreated(event.data);
        break;
        
      case 'subscription.updated':
        await handleSubscriptionUpdated(event.data);
        break;
        
      default:
        console.log('⚠️ Unhandled event type:', event.type);
    }

    // Always return 202 (acknowledged)
    res.status(202).send('');

  } catch (error) {
    if (error instanceof WebhookVerificationError) {
      console.error('❌ Webhook signature verification failed');
      console.error('   This could be a security issue!');
      return res.status(403).send('Invalid signature');
    }
    
    console.error('❌ Webhook handler error:', error);
    
    // Still return 200 to prevent retries for application errors
    res.status(200).send('');
  }
});

/**
 * Handle order.created event
 * This is where we add credits to user!
 */

async function handleOrderCreated(order) {
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('💰 ORDER CREATED HANDLER');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('Order ID:', order.id);
  console.log('Status:', order.status);

  // Only process paid orders
  if (order.status !== 'paid') {
    console.log('⏳ Order not paid yet, status:', order.status);
    return;
  }

  console.log('✅ Order is PAID - processing...');

  // ✅ IDEMPOTENCY CHECK: Bu order daha önce işlendi mi?
  console.log('🔍 Checking if order already processed...');
  
  try {
    const { data: existingTransaction, error: checkError } = await supabaseAdmin
      .from('transactions')
      .select('id, order_id, credits_added')
      .eq('order_id', order.id)
      .single();

    if (existingTransaction) {
      console.log('⚠️ ORDER ALREADY PROCESSED - SKIPPING!');
      console.log('   Existing transaction:', existingTransaction.id);
      console.log('   Credits already added:', existingTransaction.credits_added);
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      return; // ← EXIT! Duplicate işlem yapma!
    }

    // checkError varsa ve "not found" değilse hata ver
    if (checkError && checkError.code !== 'PGRST116') {
      console.error('❌ Error checking transaction:', checkError);
      throw checkError;
    }

    console.log('✅ Order is new - proceeding...');
    
  } catch (error) {
    console.error('❌ Idempotency check error:', error);
    return; // Güvenli tarafta kal, skip et
  }

  // Get metadata
  const metadata = order.metadata || {};
  
  // Get userId from metadata
  const userId = metadata.userId || metadata.user_id;
  
  if (!userId) {
    console.error('❌ No userId in order metadata');
    console.error('   Metadata:', metadata);
    return;
  }

  // Get credits from metadata
  const creditsToAdd = parseInt(metadata.planCredits || metadata.credits || 0);
  
  if (creditsToAdd === 0) {
    console.error('❌ No credits in metadata');
    return;
  }

  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('💎 ADDING CREDITS TO USER');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('User ID:', userId);
  console.log('Credits to add:', creditsToAdd);

  try {
    // Get current user credits
    const { data: currentUser, error: fetchError } = await supabaseAdmin
      .from('users')
      .select('credits, email')
      .eq('id', userId)
      .single();

    if (fetchError) {
      console.error('❌ Error fetching user:', fetchError);
      throw fetchError;
    }

    const currentCredits = currentUser?.credits || 0;
    const newCredits = currentCredits + creditsToAdd;

    console.log('Current credits:', currentCredits);
    console.log('New credits:', newCredits);

    // ✅ ÖNCE TRANSACTION OLUŞTUR (idempotency için)
    const { data: newTransaction, error: txError } = await supabaseAdmin
      .from('transactions')
      .insert({
        user_id: userId,
        order_id: order.id,
        amount: order.totalAmount || order.amount || 0,
        currency: order.currency || 'usd',
        credits_added: creditsToAdd,
        status: 'completed',
        payment_provider: 'polar',
        metadata: {
          ...metadata,
          orderStatus: order.status,
          customerEmail: order.customer?.email || currentUser.email,
          processedAt: new Date().toISOString()
        }
      })
      .select()
      .single();

    if (txError) {
      // Duplicate key error ise bu order zaten işlenmiş
      if (txError.code === '23505') {
        console.log('⚠️ DUPLICATE ORDER DETECTED - SKIPPING CREDITS!');
        console.log('   This order was already processed by another webhook');
        return; // ← EXIT!
      }
      
      console.error('❌ Error creating transaction record:', txError);
      throw txError;
    }

    console.log('✅ Transaction record created:', newTransaction.id);

    // ✅ SONRA CREDITS EKLE
    const { error: updateError } = await supabaseAdmin
      .from('users')
      .update({ 
        credits: newCredits,
        last_payment_at: new Date().toISOString()
      })
      .eq('id', userId);

    if (updateError) {
      console.error('❌ Error updating credits:', updateError);
      
      // Rollback: Transaction'ı sil
      await supabaseAdmin
        .from('transactions')
        .delete()
        .eq('id', newTransaction.id);
      
      throw updateError;
    }

    console.log('✅ Credits added successfully');
    console.log(`   ${currentCredits} → ${newCredits} (+${creditsToAdd})`);

    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('🎉 ORDER PROCESSING COMPLETED');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  } catch (error) {
    console.error('❌ Error in order processing:', error);
  }
}

/**
 * Handle order.updated event
 */
async function handleOrderUpdated(order) {
  console.log('🔄 ORDER UPDATED HANDLER');
  console.log('Order ID:', order.id);
  console.log('Status:', order.status);

  // If order status changed to paid, process it
  if (order.status === 'paid') {
    console.log('✅ Order status changed to PAID - processing...');
    await handleOrderCreated(order);
  } else {
    console.log('⏳ Order status:', order.status);
  }
}

/**
 * Handle checkout.created event
 */
async function handleCheckoutCreated(checkout) {
  console.log('🛒 CHECKOUT CREATED HANDLER');
  console.log('Checkout ID:', checkout.id);
  console.log('Status:', checkout.status);
  
  // Optional: Track checkout creation
  // Could be used for analytics
}

/**
 * Handle checkout.updated event
 */
async function handleCheckoutUpdated(checkout) {
  console.log('🛒 CHECKOUT UPDATED HANDLER');
  console.log('Checkout ID:', checkout.id);
  console.log('Status:', checkout.status);
  
  // Optional: Track checkout updates
  // Could be used for abandoned cart tracking
}

/**
 * Handle subscription.created event
 */
async function handleSubscriptionCreated(subscription) {
  console.log('📅 SUBSCRIPTION CREATED HANDLER');
  console.log('Subscription ID:', subscription.id);
  console.log('Status:', subscription.status);
  
  // TODO: Handle subscription creation
  // (for monthly/yearly plans)
}

/**
 * Handle subscription.updated event
 */
async function handleSubscriptionUpdated(subscription) {
  console.log('📅 SUBSCRIPTION UPDATED HANDLER');
  console.log('Subscription ID:', subscription.id);
  console.log('Status:', subscription.status);
  
  // TODO: Handle subscription updates
  // (renewals, cancellations, etc.)
}

module.exports = router;