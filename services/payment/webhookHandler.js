const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const { validateEvent, WebhookVerificationError } = require('@polar-sh/sdk/webhooks');
const { supabase, supabaseAdmin } = require('../../config/supabase');

/**
 * POST /api/webhooks/polar
 * Polar webhook events handler
 */
router.post('/polar', express.raw({ type: 'application/json' }), async (req, res) => {
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('🔔 POLAR WEBHOOK RECEIVED');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('Timestamp:', new Date().toISOString());

  try {
    const event = validateEvent(
      req.body,
      req.headers,
      process.env.POLAR_WEBHOOK_SECRET || 'webhook_secret_placeholder'
    );

    console.log('✅ Webhook signature validated');
    console.log('📦 Event type:', event.type);
    console.log('📦 Event ID:', event.id || 'N/A');

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

    res.status(202).send('');

  } catch (error) {
    if (error instanceof WebhookVerificationError) {
      console.error('❌ Webhook signature verification failed');
      return res.status(403).send('Invalid signature');
    }
    
    console.error('❌ Webhook handler error:', error);
    res.status(200).send('');
  }
});

/**
 * Handle order.created event
 */
async function handleOrderCreated(order) {
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('💰 ORDER CREATED HANDLER');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('Order ID:', order.id);
  console.log('Status:', order.status);

  if (order.status !== 'paid') {
    console.log('⏳ Order not paid yet, status:', order.status);
    return;
  }

  console.log('✅ Order is PAID - processing...');

  // ✅ IDEMPOTENCY CHECK
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
      return;
    }

    if (checkError && checkError.code !== 'PGRST116') {
      console.error('❌ Error checking transaction:', checkError);
      throw checkError;
    }

    console.log('✅ Order is new - proceeding...');
    
  } catch (error) {
    console.error('❌ Idempotency check error:', error);
    return;
  }

  const metadata = order.metadata || {};
  const userId = metadata.userId || metadata.user_id;
  
  if (!userId) {
    console.error('❌ No userId in order metadata');
    return;
  }

  const creditsToAdd = parseInt(metadata.planCredits || metadata.credits || 0);
  
  if (creditsToAdd === 0) {
    console.error('❌ No credits in metadata');
    return;
  }

  // ✅ Customer email (Polar'dan)
  const customerEmail = order.customer?.email || order.billing_email || null;
  console.log('📧 Customer email:', customerEmail || 'N/A');

  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('💎 ADDING CREDITS TO USER');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('User ID:', userId);
  console.log('Credits to add:', creditsToAdd);

  try {
    const { data: currentUser, error: fetchError } = await supabaseAdmin
      .from('users')
      .select('*')
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
    console.log('Is Anonymous:', currentUser.is_anonymous);
    console.log('Has Email:', currentUser.email ? 'Yes' : 'No');

    // ✅ YENİ: SADECE EMAIL KAYDET (Supabase auth OLUŞTURMA!)
    if (currentUser.is_anonymous && customerEmail && !currentUser.email) {
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      console.log('📧 SAVING EMAIL (PASSWORDLESS)');
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      console.log('   Email:', customerEmail);
      
      try {
        // ❌ Supabase Auth user OLUŞTURMA
        // Sadece email kaydet, is_anonymous = false
        
        await supabaseAdmin
          .from('users')
          .update({
            email: customerEmail,
            is_anonymous: false,
            // ❌ auth_user_id YOK (henüz)
            // ❌ auth_provider YOK (henüz)
            last_login_at: new Date().toISOString()
          })
          .eq('id', userId);

        console.log('✅ Email saved (passwordless)');
        console.log('   User can set password in soft prompt');
        
      } catch (emailError) {
        console.error('⚠️ Email save failed:', emailError.message);
      }
      
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    }

    // ✅ TRANSACTION OLUŞTUR
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
          customerEmail: customerEmail || currentUser.email,
          passwordless: currentUser.is_anonymous && customerEmail ? true : false,
          processedAt: new Date().toISOString()
        }
      })
      .select()
      .single();

    if (txError) {
      if (txError.code === '23505') {
        console.log('⚠️ DUPLICATE ORDER - SKIPPING!');
        return;
      }
      
      console.error('❌ Error creating transaction:', txError);
      throw txError;
    }

    console.log('✅ Transaction record created:', newTransaction.id);

    // ✅ CREDITS EKLE
    const { error: updateError } = await supabaseAdmin
      .from('users')
      .update({ 
        credits: newCredits,
        last_payment_at: new Date().toISOString()
      })
      .eq('id', userId);

    if (updateError) {
      console.error('❌ Error updating credits:', updateError);
      
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

async function handleOrderUpdated(order) {
  console.log('🔄 ORDER UPDATED HANDLER');
  console.log('Order ID:', order.id);
  console.log('Status:', order.status);

  if (order.status === 'paid') {
    console.log('✅ Order status changed to PAID - processing...');
    await handleOrderCreated(order);
  } else {
    console.log('⏳ Order status:', order.status);
  }
}

async function handleCheckoutCreated(checkout) {
  console.log('🛒 CHECKOUT CREATED HANDLER');
  console.log('Checkout ID:', checkout.id);
}

async function handleCheckoutUpdated(checkout) {
  console.log('🛒 CHECKOUT UPDATED HANDLER');
  console.log('Checkout ID:', checkout.id);
}

async function handleSubscriptionCreated(subscription) {
  console.log('📅 SUBSCRIPTION CREATED HANDLER');
  console.log('Subscription ID:', subscription.id);
}

async function handleSubscriptionUpdated(subscription) {
  console.log('📅 SUBSCRIPTION UPDATED HANDLER');
  console.log('Subscription ID:', subscription.id);
}

module.exports = router;