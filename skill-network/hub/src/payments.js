// payments.js — pluggable tip payment provider.
//
// Only a demo provider exists for now: it always succeeds and records
// method:'demo'. It is written as a tiny interface so WeChat Pay / Alipay / 爱发电
// can be added later. It never moves real money and never implies it does.

const PROVIDERS = {
  // charge({ amount, skillId, fromUserId }) -> { ok, method, ... }
  demo: {
    name: 'demo',
    async charge({ amount }) {
      return { ok: true, method: 'demo', amount };
    },
  },
};

export function createPaymentProvider(env = process.env) {
  const key = env.PAYMENT_PROVIDER || 'demo';
  const provider = PROVIDERS[key] || PROVIDERS.demo;
  return {
    name: provider.name,
    demo: provider.name === 'demo',
    charge: (args) => provider.charge(args),
  };
}
