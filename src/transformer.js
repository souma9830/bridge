/**
 * Transforms a Stellar SDK operation object into a clean, normalized JSON
 * payload for downstream webhook consumers.
 *
 * Supports: payment, path_payment_strict_send, path_payment_strict_receive,
 *           create_account, account_merge, change_trust,
 *           manage_sell_offer, manage_buy_offer.
 *
 * @param {Object} operation - The operation object from the Stellar SDK stream
 * @returns {Object} Simplified, normalized payload
 */
function transformPayload(operation) {
  // ── Base fields present on every operation ──
  const payload = {
    id: operation.id,
    paging_token: operation.paging_token,
    transaction_hash: operation.transaction_hash,
    type: operation.type,
    created_at: operation.created_at,
    source_account: operation.source_account,
  };

  switch (operation.type) {
    // ── Payments ──
    case 'payment':
    case 'path_payment_strict_send':
    case 'path_payment_strict_receive':
      payload.from = operation.from;
      payload.to = operation.to;
      payload.amount = operation.amount;
      payload.asset_type = operation.asset_type;

      if (operation.asset_type === 'native') {
        payload.asset_code = 'XLM';
      } else {
        payload.asset_code = operation.asset_code;
        payload.asset_issuer = operation.asset_issuer;
      }

      // Path payments have source/destination asset info
      if (operation.type !== 'payment') {
        payload.source_amount = operation.source_amount;
        payload.source_asset_type = operation.source_asset_type;
        if (operation.source_asset_type === 'native') {
          payload.source_asset_code = 'XLM';
        } else {
          payload.source_asset_code = operation.source_asset_code;
          payload.source_asset_issuer = operation.source_asset_issuer;
        }
      }
      break;

    // ── Account creation ──
    case 'create_account':
      payload.funder = operation.funder;
      payload.account = operation.account;
      payload.starting_balance = operation.starting_balance;
      break;

    // ── Account merge ──
    case 'account_merge':
      payload.account = operation.account;
      payload.into = operation.into;
      break;

    // ── Trustline changes ──
    case 'change_trust':
      payload.trustor = operation.trustor;
      payload.asset_type = operation.asset_type;
      payload.asset_code = operation.asset_code;
      payload.asset_issuer = operation.asset_issuer;
      payload.limit = operation.limit;
      break;

    // ── DEX offers ──
    case 'manage_sell_offer':
    case 'manage_buy_offer':
    case 'create_passive_sell_offer':
      payload.offer_id = operation.offer_id;
      payload.amount = operation.amount;
      payload.price = operation.price;

      // Selling asset
      if (operation.selling_asset_type === 'native') {
        payload.selling_asset_code = 'XLM';
      } else {
        payload.selling_asset_code = operation.selling_asset_code;
        payload.selling_asset_issuer = operation.selling_asset_issuer;
      }

      // Buying asset
      if (operation.buying_asset_type === 'native') {
        payload.buying_asset_code = 'XLM';
      } else {
        payload.buying_asset_code = operation.buying_asset_code;
        payload.buying_asset_issuer = operation.buying_asset_issuer;
      }
      break;

    // ── Fallback for unhandled types ──
    default:
      payload._raw = operation;
      break;
  }

  return payload;
}

module.exports = { transformPayload };
