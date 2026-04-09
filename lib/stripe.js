// ============================================================
// lib/stripe.js — Stripe SDK wrapper
// ============================================================

import Stripe from 'stripe';
import { requireEnv } from './security.js';

let _stripe = null;

export function getStripe() {
  if (!_stripe) {
    _stripe = new Stripe(requireEnv('STRIPE_SECRET_KEY'), {
      apiVersion: '2024-12-18.acacia',
      typescript: false,
    });
  }
  return _stripe;
}

/**
 * Verify a Stripe webhook signature. This is CRITICAL security — without
 * it, anyone can POST to /api/stripe-webhook and trigger key generation.
 *
 * @param {Buffer|string} rawBody - the raw request body (NOT parsed JSON)
 * @param {string} signature - the Stripe-Signature header
 * @returns {Stripe.Event}
 */
export function verifyWebhookSignature(rawBody, signature) {
  const stripe = getStripe();
  const secret = requireEnv('STRIPE_WEBHOOK_SECRET');
  return stripe.webhooks.constructEvent(rawBody, signature, secret);
}
