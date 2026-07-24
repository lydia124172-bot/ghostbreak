/**
 * Paid plan definitions and delivery routing (planId takes priority).
 */
const PLANS = {
  email: {
    id: 'email',
    name: 'AI Breakup Letter (Email)',
    amount: '9.99',
    paid: true,
    sendEmail: true,
    sendSms: false,
    includesPdf: false,
  },
  sms: {
    id: 'sms',
    name: 'Anonymous Breakup SMS',
    amount: '19.99',
    paid: true,
    sendEmail: false,
    sendSms: true,
    includesPdf: false,
  },
  bundle: {
    id: 'bundle',
    name: 'Premium Bundle — SMS + Email',
    amount: '24.99',
    paid: true,
    sendEmail: true,
    sendSms: true,
    includesPdf: true,
  },
};

const SURVIVAL_GUIDE_PATH = '/downloads/survival-guide.pdf';

function getPlan(planId) {
  return PLANS[planId] || null;
}

function resolvePlanDelivery({ planId, exEmail, exPhone }) {
  const plan = getPlan(planId);
  if (!plan) {
    return { sendEmail: false, sendSms: false, plan: null };
  }

  if (planId === 'sms') {
    return { sendEmail: false, sendSms: Boolean(exPhone), plan };
  }
  if (planId === 'email') {
    return { sendEmail: Boolean(exEmail), sendSms: false, plan };
  }
  if (planId === 'bundle') {
    return {
      sendEmail: Boolean(exEmail),
      sendSms: Boolean(exPhone),
      plan,
    };
  }

  return { sendEmail: false, sendSms: false, plan };
}

function validatePlanDelivery(planId, { exEmail, exPhone }) {
  const plan = getPlan(planId);
  if (!plan?.paid) return 'Invalid paid plan.';

  if (planId === 'sms' && !exPhone) {
    return 'SMS plan ($19.99): please enter your ex\'s phone number.';
  }
  if (planId === 'email' && !exEmail) {
    return 'Email plan ($9.99): please enter your ex\'s email address.';
  }
  if (planId === 'bundle') {
    if (!exEmail) {
      return 'Bundle plan ($24.99): please enter your ex\'s email address for email delivery.';
    }
    if (!exPhone) {
      return 'Bundle plan ($24.99): please enter your ex\'s phone number for SMS delivery.';
    }
  }

  const { sendEmail, sendSms } = resolvePlanDelivery({ planId, exEmail, exPhone });
  if (planId === 'bundle' && (!sendEmail || !sendSms)) {
    return 'Bundle plan ($24.99): both a valid email and phone number are required for SMS + Email delivery.';
  }
  if (!sendEmail && !sendSms) {
    return 'Cannot deliver with the current contact info. Please check the format.';
  }

  return null;
}

module.exports = {
  PLANS,
  SURVIVAL_GUIDE_PATH,
  getPlan,
  resolvePlanDelivery,
  validatePlanDelivery,
};
