const express = require('express');
const router = express.Router();
const { Paddle, EventName } = require('@paddle/paddle-node-sdk');
const { supabaseAdmin } = require('../config/supabase');

// Paddle client initialize
const paddle = new Paddle(process.env.PADDLE_API_KEY || '');

// PRICE ID'lerden credits mapping
const PRICE_TO_CREDITS = {
  // Weekly Pass - 20 credits
  'pri_01k885kd54vvka1hwjh5ftbsey': 20,
  
  // Monthly Pro - 50 credits
  'pri_01k885p36tg85wx9j7hhx83z7b': 50,
  
  // Yearly VIP - 100 credits
  'pri_01k885qvwyz3m794tkqxr03k23': 100,
  
  // 200 Credits Pack - 200 credits
  'pri_01k885v4b7bf2drha0vcw8pcbj': 200,
};

// ============================
// WEBHOOK ENDPOINT
// ============================
router.post('/', express.raw({ type: 'application/json' }), async (req, res) => {
  try {
    console.log('📨 Paddle webhook received');

    // 1. Signature verification
    const signature = req.headers['paddle-signature'];
    if (!signature) {
      console.error('❌ No signature in header');
      return res.status(401).json({ error: 'No signature' });
    }

    const rawBody = req.body.toString();
    const webhookSecret = process.env.PADDLE_WEBHOOK_SECRET;

    if (!webhookSecret) {
      console.error('❌ PADDLE_WEBHOOK_SECRET not configured');
      return res.status(500).json({ error: 'Server misconfigured' });
    }

    // 2. Verify and unmarshal webhook
    let eventData;
    try {
      eventData = await paddle.webhooks.unmarshal(rawBody, webhookSecret, signature);
      console.log('✅ Webhook verified:', eventData.eventType);
    } catch (verifyError) {
      console.error('❌ Verification failed:', verifyError.message);
      return res.status(400).json({ error: 'Invalid signature' });
    }

    // 3. Check for duplicate (idempotency)
    const eventId = eventData.eventId;
    const { data: existingEvent } = await supabaseAdmin
      .from('paddle_events')
      .select('id')
      .eq('event_id', eventId)
      .single();

    if (existingEvent) {
      console.log('⚠️ Duplicate event, skipping');
      return res.status(200).json({ message: 'Duplicate' });
    }

    // 4. Log event to database
    await supabaseAdmin
      .from('paddle_events')
      .insert({
        event_id: eventId,
        event_type: eventData.eventType,
        payload: eventData.data,
        processed: false
      });

    // 5. Process based on event type
    switch (eventData.eventType) {
      case EventName.TransactionCompleted:
        await handleTransactionCompleted(eventData.data);
        break;

      case EventName.SubscriptionCreated:
        await handleSubscriptionCreated(eventData.data);
        break;

      case EventName.SubscriptionUpdated:
        await handleSubscriptionUpdated(eventData.data);
        break;

      case EventName.SubscriptionCanceled:
        await handleSubscriptionCanceled(eventData.data);
        break;

      default:
        console.log('ℹ️ Unhandled event:', eventData.eventType);
    }

    // 6. Mark as processed
    await supabaseAdmin
      .from('paddle_events')
      .update({ processed: true, processed_at: new Date().toISOString() })
      .eq('event_id', eventId);

    // 7. Respond 200 OK (must be within 5 seconds!)
    console.log('✅ Webhook processed');
    res.status(200).json({ success: true });

  } catch (error) {
    console.error('❌ Webhook error:', error);
    // Still return 200 to prevent Paddle retries
    res.status(200).json({ error: 'Processing failed' });
  }
});

// ============================
// EVENT HANDLERS
// ============================

async function handleTransactionCompleted(transaction) {
  console.log('💰 Transaction completed:', transaction.id);

  try {
    // Get customer email
    const customerEmail = transaction.customer_id 
      ? await getCustomerEmail(transaction.customer_id)
      : transaction.details?.email;

    if (!customerEmail) {
      console.error('❌ No customer email');
      return;
    }

    // Get user from database
    const { data: user, error: userError } = await supabaseAdmin
      .from('users')
      .select('id, email, credits')
      .eq('email', customerEmail)
      .single();

    if (userError || !user) {
      console.error('❌ User not found:', customerEmail);
      return;
    }

    // Calculate credits from items
    let totalCredits = 0;
    for (const item of transaction.items) {
      const priceId = item.price.id;
      const credits = PRICE_TO_CREDITS[priceId] || 0;
      totalCredits += credits * (item.quantity || 1);
    }

    if (totalCredits === 0) {
      console.warn('⚠️ No credits for price IDs');
      return;
    }

    // Add credits to user
    const { data: updated, error: updateError } = await supabaseAdmin
      .from('users')
      .update({ 
        credits: user.credits + totalCredits,
        updated_at: new Date().toISOString()
      })
      .eq('id', user.id)
      .select()
      .single();

    if (updateError) {
      console.error('❌ Credits update failed:', updateError);
      return;
    }

    console.log(`✅ Added ${totalCredits} credits to ${user.email}`);
    console.log(`   New balance: ${updated.credits}`);

    // Log transaction
    await supabaseAdmin
      .from('transactions')
      .insert({
        user_id: user.id,
        transaction_id: transaction.id,
        amount: transaction.details.totals.total,
        currency: transaction.currency_code,
        credits_added: totalCredits,
        status: 'completed'
      });

  } catch (error) {
    console.error('❌ Transaction handler error:', error);
  }
}

async function handleSubscriptionCreated(subscription) {
  console.log('📅 Subscription created:', subscription.id);

  try {
    // Get customer email
    const customerEmail = await getCustomerEmail(subscription.customer_id);
    
    if (!customerEmail) {
      console.error('❌ No customer email');
      return;
    }

    // Get user
    const { data: user } = await supabaseAdmin
      .from('users')
      .select('id')
      .eq('email', customerEmail)
      .single();

    if (!user) {
      console.error('❌ User not found');
      return;
    }

    // Save subscription
    await supabaseAdmin
      .from('subscriptions')
      .insert({
        user_id: user.id,
        paddle_subscription_id: subscription.id,
        paddle_customer_id: subscription.customer_id,
        status: subscription.status,
        plan_id: subscription.items[0]?.price.id,
        current_billing_period_start: subscription.current_billing_period?.starts_at,
        current_billing_period_end: subscription.current_billing_period?.ends_at,
        next_billed_at: subscription.next_billed_at
      });

    console.log(`✅ Subscription saved for ${customerEmail}`);

  } catch (error) {
    console.error('❌ Subscription handler error:', error);
  }
}

async function handleSubscriptionUpdated(subscription) {
  console.log('🔄 Subscription updated:', subscription.id);

  try {
    await supabaseAdmin
      .from('subscriptions')
      .update({
        status: subscription.status,
        next_billed_at: subscription.next_billed_at,
        updated_at: new Date().toISOString()
      })
      .eq('paddle_subscription_id', subscription.id);

    console.log('✅ Subscription updated');

  } catch (error) {
    console.error('❌ Subscription update error:', error);
  }
}

async function handleSubscriptionCanceled(subscription) {
  console.log('❌ Subscription canceled:', subscription.id);

  try {
    await supabaseAdmin
      .from('subscriptions')
      .update({
        status: 'canceled',
        canceled_at: new Date().toISOString()
      })
      .eq('paddle_subscription_id', subscription.id);

    console.log('✅ Subscription canceled');

  } catch (error) {
    console.error('❌ Subscription cancel error:', error);
  }
}

// Helper: Get customer email from Paddle
async function getCustomerEmail(customerId) {
  try {
    const customer = await paddle.customers.get(customerId);
    return customer.email;
  } catch (error) {
    console.error('❌ Failed to get customer:', error);
    return null;
  }
}

module.exports = router;