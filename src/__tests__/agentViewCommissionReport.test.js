'use strict';

const fs = require('fs');
const path = require('path');
const {
  isAgentViewCommissionReport,
  parseAgentViewCommissionReportText,
} = require('../agentViewCommissionReport');

const FIXTURE_TXT = path.join(__dirname, 'fixtures/agentview-cnhic-202608.txt');

describe('agentViewCommissionReport', () => {
  test('detects AgentView / AgentCommissionReport PDFs', () => {
    expect(isAgentViewCommissionReport('AgentCommissionReport__1__68ea.pdf')).toBe(true);
    expect(isAgentViewCommissionReport('CNHIC AgentView Commission Report Aug.pdf')).toBe(true);
    expect(isAgentViewCommissionReport('humana_commission.pdf')).toBe(false);
    expect(isAgentViewCommissionReport('AgentCommissionReport.xlsx')).toBe(false);
  });

  test('parses Mushkin earnings from pdf-parse text', () => {
    const text = `
Agent Name:  THE HEALTH EXPERTS INSURANCE
AgentView Commission Report
Report Period:  08/01/26 - to - 08/14/26
Agent ID(s): CB142243,CNHIC;
CompanyAgt IdFirst Year
CNHICCB142243                $111.45
Totals$111.45
Agent IDCompanyPolicy NumberInsured Name
CB142243CNHIC60Y0436424MUSHKIN, SILVIA
CB142243CNHIC60Y0436880MUSHKIN, JULIUS
Earnings
Prem Due DateDur YrEff DatePlanMarketing NameModeRate
08/01/2026107/01/2026MIM20BM60GHNHIC MEDSUP 
STD PLAN G 
(ISSUE AGE)     
118.00
08/01/2026107/01/2026MIM20BM60GHNHIC MEDSUP 
STD PLAN G 
(ISSUE AGE)     
118.00
 Comm PremiumEarningsDescComm PaidCycle Date
$308.82$55.59Earnings Paid$55.5908/14/2026
$310.31$55.86Earnings Paid$55.8608/14/2026
Total Commission Paid$111.45
Writing AgtWriting Agt NameUnder Writing ClassCommission Option CodeInternal Replacement Indicator
SYSCB142243PEREZ,YAHOSKAOE01NO
SYSCB142243PEREZ,YAHOSKAOE01NO
Issue StatePolicy Advance Balance
FL0.00             
FL0.00             
`;
    const rows = parseAgentViewCommissionReportText(text, 'AgentView.pdf');
    expect(rows).toHaveLength(2);
    expect(rows.reduce((s, r) => s + r.commission, 0)).toBeCloseTo(111.45, 2);

    expect(rows[0]).toMatchObject({
      client: 'Silvia Mushkin',
      policyNumber: '60Y0436424',
      carrier: 'HealthSpring',
      commission: 55.59,
      premium: 118,
      period: '202608',
      classification: 'NB',
      agent: 'Yahoska Perez',
      effectiveDate: '2026-07-01',
      memberState: 'FL',
    });
    expect(rows[0].planType).toMatch(/PLAN G/i);

    expect(rows[1]).toMatchObject({
      client: 'Julius Mushkin',
      policyNumber: '60Y0436880',
      commission: 55.86,
      agent: 'Yahoska Perez',
    });
  });

  test('parses real AgentView PDF text fixture', () => {
    expect(fs.existsSync(FIXTURE_TXT)).toBe(true);
    const text = fs.readFileSync(FIXTURE_TXT, 'utf8');
    const rows = parseAgentViewCommissionReportText(text, 'AgentCommissionReport.pdf');
    expect(rows).toHaveLength(2);
    expect(rows.map(r => r.policyNumber).sort()).toEqual(['60Y0436424', '60Y0436880']);
    expect(rows.reduce((s, r) => s + r.commission, 0)).toBeCloseTo(111.45, 2);
    expect(rows.every(r => r.agent === 'Yahoska Perez')).toBe(true);
    expect(rows.every(r => r.carrier === 'HealthSpring')).toBe(true);
    expect(rows.every(r => r.period === '202608')).toBe(true);
  });
});
