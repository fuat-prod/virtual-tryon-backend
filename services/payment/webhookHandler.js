const express = require('express');
const router = express.Router();
const crypto = require('crypto'); // ✅ YENİ: Random password için
const { validateEvent, WebhookVerificationError } = require('@polar-sh/sdk/webhooks');
const { supabase, supabaseAdmin } = require('../../config/supabase'); // ✅ YENİ: supabase ekle

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

  // ✅ YENİ: Customer email (Polar'dan)
  const customerEmail = order.customer?.email || order.billing_email || null;
  console.log('📧 Customer email:', customerEmail || 'N/A');

  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('💎 ADDING CREDITS TO USER');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('User ID:', userId);
  console.log('Credits to add:', creditsToAdd);

  try {
    // Get current user
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

    // ✅ YENİ: AUTO-MIGRATE ANONYMOUS USER
    if (currentUser.is_anonymous && customerEmail && !currentUser.email) {
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      console.log('🔄 AUTO-MIGRATING ANONYMOUS USER');
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      console.log('   Email:', customerEmail);
      
      try {
        // 1. Random password oluştur
        const randomPassword = crypto.randomBytes(16).toString('hex');
        
        // 2. Supabase Auth user oluştur
        const { data: authData, error: authError } = await supabase.auth.signUp({
          email: customerEmail,
          password: randomPassword,
          options: {
            data: {
              auto_created: true,
              from_payment: true
            }
          }
        });

        if (authError) {
          console.error('⚠️ Auth user creation failed:', authError.message);
          // Continue with credits anyway
        } else if (authData?.user) {
          console.log('✅ Auth user created:', authData.user.id);
          
          // 3. Users tablosunda email ve auth bilgilerini güncelle
          await supabaseAdmin
            .from('users')
            .update({
              email: customerEmail,
              is_anonymous: false,
              auth_provider: 'email',
              auth_user_id: authData.user.id,
              last_login_at: new Date().toISOString()
            })
            .eq('id', userId);

          console.log('✅ User migrated to authenticated');

          // 4. Password reset email gönder
          try {
            await supabase.auth.resetPasswordForEmail(customerEmail, {
              redirectTo: `${process.env.FRONTEND_URL || 'https://www.dressai.app'}/reset-password`
            });
            console.log('✅ Password reset email sent');
          } catch (emailError) {
            console.error('⚠️ Password reset email failed:', emailError.message);
          }
        }
      } catch (migrateError) {
        console.error('⚠️ Auto-migration failed:', migrateError.message);
        console.log('   Continuing with credits addition...');
      }
      
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    }

    // ✅ TRANSACTION OLUŞTUR (idempotency için)
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
          autoMigrated: currentUser.is_anonymous && customerEmail ? true : false,
          processedAt: new Date().toISOString()
        }
      })
      .select()
      .single();

    if (txError) {
      if (txError.code === '23505') {
        console.log('⚠️ DUPLICATE ORDER DETECTED - SKIPPING CREDITS!');
        return;
      }
      
      console.error('❌ Error creating transaction record:', txError);
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
}

/**
 * Handle checkout.updated event
 */
async function handleCheckoutUpdated(checkout) {
  console.log('🛒 CHECKOUT UPDATED HANDLER');
  console.log('Checkout ID:', checkout.id);
  console.log('Status:', checkout.status);
}

/**
 * Handle subscription.created event
 */
async function handleSubscriptionCreated(subscription) {
  console.log('📅 SUBSCRIPTION CREATED HANDLER');
  console.log('Subscription ID:', subscription.id);
  console.log('Status:', subscription.status);
}

/**
 * Handle subscription.updated event
 */
async function handleSubscriptionUpdated(subscription) {
  console.log('📅 SUBSCRIPTION UPDATED HANDLER');
  console.log('Subscription ID:', subscription.id);
  console.log('Status:', subscription.status);
}

module.exports = router;