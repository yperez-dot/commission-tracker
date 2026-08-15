'use strict';

const {
  auditOverrideGaps,
  isOverrideLikeRow,
  sumBySign,
} = require('../overrideGapAudit');

describe('overrideGapAudit', () => {
  test('flags Milagros-style returnee clawback', () => {
    const production = [
      {
        id: 1,
        client_name: 'MILAGROS CAMBAS DE RIVAS',
        carrier: 'Aetna',
        agent_name: 'Hernandez, Alba',
        status: 'Active',
      },
    ];
    const overrides = [
      {
        id: 10,
        client_full_name: 'CAMBAS DE RIVAS, MILAGROS',
        carrier: 'Aetna',
        commission: 80,
        classification: 'Agency Override',
        payee: 'THE',
      },
      {
        id: 11,
        client_full_name: 'Milagros Cambas De Rivas',
        carrier: 'Aetna',
        commission: -80,
        classification: 'Chargeback',
        payee: 'THE',
      },
    ];

    const { summary, gaps } = auditOverrideGaps(production, overrides);
    expect(summary.returnee_clawback).toBe(1);
    expect(gaps[0].gap_type).toBe('returnee_clawback');
    expect(gaps[0].override_net).toBe(0);
    expect(gaps[0].paid_total).toBe(80);
    expect(gaps[0].chargeback_total).toBe(-80);
  });

  test('flags never_paid when production has no override', () => {
    const { gaps } = auditOverrideGaps(
      [{ id: 2, client_name: 'Jane Doe', carrier: 'Humana', agent_name: 'A' }],
      []
    );
    expect(gaps).toHaveLength(1);
    expect(gaps[0].gap_type).toBe('never_paid');
  });

  test('does not flag currently paid clients', () => {
    const { gaps, summary } = auditOverrideGaps(
      [{ id: 3, client_name: 'Paid Client', carrier: 'Aetna' }],
      [
        {
          client_full_name: 'Paid Client',
          carrier: 'Aetna',
          commission: 150,
          classification: 'Agency Override',
        },
      ]
    );
    expect(gaps).toHaveLength(0);
    expect(summary.gap_total).toBe(0);
  });

  test('dedupes rolling production duplicates for same sale', () => {
    const { summary } = auditOverrideGaps(
      [
        {
          id: 1,
          client_name: 'RONALDO BALBOA',
          carrier: 'Devoted',
          effective_date: '2026-05-01',
          policy_number: 'X1',
        },
        {
          id: 2,
          client_name: 'BALBOA, RONALDO',
          carrier: 'Devoted Health',
          effective_date: '2026-05-01',
          policy_number: 'X1',
        },
      ],
      []
    );
    expect(summary.production_rows_raw).toBe(2);
    expect(summary.production_clients).toBe(1);
    expect(summary.never_paid).toBe(1);
  });

  test('isOverrideLikeRow includes chargebacks', () => {
    expect(isOverrideLikeRow({ classification: 'Chargeback', payee: 'THE' })).toBe(true);
    expect(sumBySign([{ commission: 80 }, { commission: -80 }])).toEqual({
      paid: 80,
      chargeback: -80,
      paidCount: 1,
      chargebackCount: 1,
    });
  });
});
