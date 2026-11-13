import { describe, expect, it } from 'vitest';
import {
  GSTIN,
  ariRows,
  csvCells,
  einvoicePayload,
  gstinState,
  parsePayout,
  payLinkMade,
  payLinkRequest,
  payWebhook,
  reconcile,
} from './index';

describe('channel manager (X2)', () => {
  it('sends availability, price and restrictions for mapped room types only — never a negative count', () => {
    const inv = [
      { roomTypeId: 'dlx', day: '2026-11-20', left: 3, rule: {} },
      { roomTypeId: 'dlx', day: '2026-11-21', left: -1, rule: { stopSell: true, minStay: 2 } },
      { roomTypeId: 'ste', day: '2026-11-20', left: 2, rule: {} },
    ];
    const rows = ariRows(inv, (t) => (t === 'dlx' ? 4000_00 : null), {
      rooms: [{ roomTypeId: 'dlx', code: 'DELUXE-KING' }],
      rateCode: 'BAR',
    });
    expect(rows).toEqual([
      {
        room: 'DELUXE-KING',
        rate: 'BAR',
        date: '2026-11-20',
        available: 3,
        price: 4000_00,
        stopSell: false,
        closedToArrival: false,
        minStay: null,
      },
      {
        room: 'DELUXE-KING',
        rate: 'BAR',
        date: '2026-11-21',
        available: 0,
        price: 4000_00,
        stopSell: true,
        closedToArrival: false,
        minStay: 2,
      },
    ]);
  });
});

describe('payment gateways (X8, X9)', () => {
  const ask = {
    reference: 'PL-7',
    amount: 150000,
    description: 'Table deposit',
    customer: { name: 'Asha', phone: '+919829011111' },
    callbackUrl: 'https://mono.example/pay/PL-7',
  };
  it('builds a Razorpay link request and reads its answer and webhook', () => {
    const r = payLinkRequest('RAZORPAY', { keyId: 'rzp_k', keySecret: 's' }, ask);
    expect(r.url).toBe('https://api.razorpay.com/v1/payment_links');
    expect(r.basic).toEqual(['rzp_k', 's']);
    expect(r.body).toMatchObject({
      amount: 150000,
      currency: 'INR',
      reference_id: 'PL-7',
      customer: { name: 'Asha', contact: '+919829011111' },
    });
    expect(payLinkMade('RAZORPAY', { id: 'plink_1', short_url: 'https://rzp.io/i/x' })).toEqual({
      id: 'plink_1',
      url: 'https://rzp.io/i/x',
    });
    expect(payLinkMade('RAZORPAY', { error: {} })).toBeNull();
    const hook = {
      event: 'payment_link.paid',
      payload: {
        payment_link: { entity: { id: 'plink_1', reference_id: 'PL-7', amount_paid: 150000 } },
        payment: { entity: { id: 'pay_9' } },
      },
    };
    expect(payWebhook('RAZORPAY', hook)).toEqual({ reference: 'PL-7', amount: 150000, paymentId: 'pay_9' });
    expect(payWebhook('RAZORPAY', { event: 'payment.failed' })).toBeNull();
  });
  it('builds a Cashfree link request (rupees, not paise) and reads its answer and webhook', () => {
    const r = payLinkRequest('CASHFREE', { clientId: 'c', clientSecret: 's' }, ask);
    expect(r.url).toBe('https://api.cashfree.com/pg/links');
    expect(r.headers['x-client-id']).toBe('c');
    expect(r.body).toMatchObject({
      link_id: 'PL-7',
      link_amount: 1500,
      link_currency: 'INR',
      customer_details: { customer_phone: '+919829011111' },
    });
    expect(
      payLinkMade('CASHFREE', { cf_link_id: 88, link_url: 'https://payments.cashfree.com/links/x' }),
    ).toEqual({ id: '88', url: 'https://payments.cashfree.com/links/x' });
    const hook = {
      type: 'PAYMENT_LINK_EVENT',
      data: { link_id: 'PL-7', link_status: 'PAID', link_amount_paid: 1500, order: { transaction_id: 'T1' } },
    };
    expect(payWebhook('CASHFREE', hook)).toEqual({ reference: 'PL-7', amount: 150000, paymentId: 'T1' });
    expect(
      payWebhook('CASHFREE', {
        type: 'PAYMENT_LINK_EVENT',
        data: { link_id: 'PL-7', link_status: 'PARTIALLY_PAID' },
      }),
    ).toBeNull();
  });
});

describe('aggregator payouts (X13, X14)', () => {
  it('reads a payout file by its headings', () => {
    expect(csvCells('a,"b, c","d ""e"""')).toEqual(['a', 'b, c', 'd "e"']);
    const csv =
      'Order ID,Order Total,Commission,Net Payout\r\nZ-101,"1,000.00",250.00,750.00\r\nZ-102,500,125,375\r\n,1,1,1\r\nZ-101,1,1,1\r\n';
    const { rows, problems } = parsePayout(csv);
    expect(rows).toEqual([
      { ref: 'Z-101', gross: 1000_00, deductions: 250_00, net: 750_00 },
      { ref: 'Z-102', gross: 500_00, deductions: 125_00, net: 375_00 },
    ]);
    expect(problems).toEqual(['Line 5: order Z-101 is in the file twice']);
    expect(parsePayout('Name,Amount\r\nx,1').problems).toEqual([
      'No order-number column was found',
      'No payout column was found',
    ]);
    // With no deduction column, what was taken off is the order's value less the payout.
    expect(parsePayout('order_id,gross,net\nA,100,80').rows).toEqual([
      { ref: 'A', gross: 100_00, deductions: 20_00, net: 80_00 },
    ]);
  });
  it('sets the file against the POS orders', () => {
    const r = reconcile(
      [
        { ref: 'Z-101', billed: 1000_00 },
        { ref: 'Z-102', billed: 520_00 },
        { ref: 'Z-103', billed: 300_00 },
      ],
      [
        { ref: 'Z-101', gross: 1000_00, deductions: 250_00, net: 750_00 },
        { ref: 'Z-102', gross: 500_00, deductions: 125_00, net: 375_00 },
        { ref: 'Z-999', gross: 100_00, deductions: 25_00, net: 75_00 },
      ],
    );
    expect(r.matched).toEqual([
      { ref: 'Z-101', billed: 1000_00, net: 750_00, deductions: 250_00, diff: 0 },
      { ref: 'Z-102', billed: 520_00, net: 375_00, deductions: 125_00, diff: 20_00 },
    ]);
    expect(r.unknown.map((x) => x.ref)).toEqual(['Z-999']);
    expect(r.unpaid).toEqual([{ ref: 'Z-103', billed: 300_00 }]);
  });
});

describe('e-invoice (X15)', () => {
  const seller = {
    gstin: '08AAAAA0000A1Z5',
    name: 'GGM Hotels Rajasthan',
    address: 'MI Road',
    place: 'Jaipur',
    pin: 302001,
    stateCode: '08',
  };
  const line = {
    name: 'Banquet — per plate',
    hsn: '996334',
    qty: 100,
    unit: 'nos',
    rate: 800_00,
    taxable: 80000_00,
    percent: 5,
    tax: 4000_00,
    total: 84000_00,
  };
  const totals = { taxable: 80000_00, tax: 4000_00, roundOff: 0, total: 84000_00 };
  it('splits tax by the two states and writes rupees', () => {
    const same = einvoicePayload({
      seller,
      buyer: { ...seller, gstin: '08BBBBB1111B1Z2', name: 'Acme' },
      doc: { type: 'INV', number: 'INV/RJ/26-27/0007', date: '2026-11-13' },
      lines: [line],
      totals,
    });
    expect(same.DocDtls).toEqual({ Typ: 'INV', No: 'INV/RJ/26-27/0007', Dt: '13/11/2026' });
    expect(same.ItemList[0]).toMatchObject({
      SlNo: '1',
      IsServc: 'Y',
      HsnCd: '996334',
      Qty: 100,
      UnitPrice: 800,
      AssAmt: 80000,
      GstRt: 5,
      CgstAmt: 2000,
      SgstAmt: 2000,
      IgstAmt: 0,
      TotItemVal: 84000,
    });
    expect(same.ValDtls).toMatchObject({
      AssVal: 80000,
      CgstAmt: 2000,
      SgstAmt: 2000,
      IgstAmt: 0,
      TotInvVal: 84000,
    });
    const other = einvoicePayload({
      seller,
      buyer: { ...seller, gstin: '07CCCCC2222C1Z9', stateCode: '07' },
      doc: { type: 'INV', number: 'X', date: '2026-11-13' },
      lines: [line],
      totals,
    });
    expect(other.ValDtls).toMatchObject({ IgstAmt: 4000, CgstAmt: 0, SgstAmt: 0 });
    expect(other.BuyerDtls.Pos).toBe('07');
  });
  it('knows a GSTIN and its state', () => {
    expect(GSTIN.test('08AAAAA0000A1Z5')).toBe(true);
    expect(GSTIN.test('8AAAAA0000A1Z5')).toBe(false);
    expect(gstinState('08AAAAA0000A1Z5')).toBe('08');
    expect(gstinState(null)).toBeNull();
  });
});
