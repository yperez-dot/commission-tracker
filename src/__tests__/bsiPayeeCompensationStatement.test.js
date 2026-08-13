'use strict';

const {
  isBsiPayeeCompensationStatement,
  parseBsiPayeeCompensationStatement,
  splitPolicyClient,
  periodFromText,
} = require('../bsiPayeeCompensationStatement');

const JULY_TEXT = `
Date: 08/06/2026
                                              Detailed Compensation Statement                                                
July Statement
AgencyCompanyPolicy #Client NameEffective Date Commission
BROKER SOCIETY INSURANCE
AETNA
NG102227785800MONTES DE TRIGUEROS,M12/1/2025$36.00
BROKER SOCIETY INSURANCE
AETNA
NG102194943300ORTIZ,MARGARITA10/1/2025$28.92
BROKER SOCIETY INSURANCE
AETNA
NG102198631200ZAFRA,ALFREDO11/01/2025$28.92
BROKER SOCIETY INSURANCE
HUMANA
00017418524K_PPOMARIAD JUAREZ GRANADOS01/01/2026-$60.00
BROKER SOCIETY INSURANCE
UNITED HEALTH CARE
917999971GUERRA, ROSA4/1/2026$694.00
BROKER SOCIETY INSURANCE
UNITED HEALTH CARE
951906631TREVINO, SALVADOR G.
08/01/2026$694.00
BROKER SOCIETY INSURANCE
UNITED HEALTH CARE
136066587SANCHEZ DEJESUS, ARMANDO
6/1/2026$781.00
BROKER SOCIETY INSURANCE
UNITED HEALTH CARE
HRA
SANCHEZ DEJESUS, ARMANDO
-$50.00
BROKER SOCIETY INSURANCE
UNITED HEALTH CARE
904039800VILORIO, JUAN7/1/2026$195.50
BROKER SOCIETY INSURANCE
UNITED HEALTH CARE
942128185LOPEZ, MIREYA
7/1/2026
$173.50
BROKER SOCIETY INSURANCE
UNITED HEALTH CARE
127771631NAVARRO, DORA
7/1/2026
$173.50
BROKER SOCIETY INSURANCE
UNITED HEALTH CARE
118494788GONZALEZ, NORMA A.01/01/2026
-$144.58
BROKER SOCIETY INSURANCE
AETNA
NG102208418300VAZQUEZ VELEZ M,AIDA
01/01/2026
-$130.33
BROKER SOCIETY INSURANCE
AETNA
NG102208641900VAZQUEZ,BETHZAIDA
01/01/2026
-$130.33
Balance:$2,390.10
`;

const JUNE_TEXT = `
Date: 07/09/2026
                                              Detailed Compensation Statement                                                
AgencyCompanyPolicy #Client NameEffective Date Commission
BROKER SOCIETY INSURANCE
AETNA
MEQNDVZM00000182763JERNIGAN,EQUILLA
2/1/2026
-$404.83
BROKER SOCIETY INSURANCE
AETNA
NG101559278000MORALES Y,VILMA
5/1/2026
$864.00
BROKER SOCIETY INSURANCE
AETNA
NG101559278000DURAN,CRISTINA06/01/2026
$202.41
BROKER SOCIETY INSURANCE
AETNA
NG102227785800MONTES DE TRIGUEROS,M12/1/2025
$36.00
BROKER SOCIETY INSURANCE
AETNA
NG102194943300ORTIZ,MARGARITA10/1/2025
$28.92
BROKER SOCIETY INSURANCE
AETNA
NG102198631200ZAFRA,ALFREDO11/01/2025
$28.92
BROKER SOCIETY INSURANCE
AETNA
NG102281092100AREVALO R,JOSE6/1/2026
$252.00
BROKER SOCIETY INSURANCE
AETNA
HRATEXAS, JOE-$55.00
BROKER SOCIETY INSURANCE
AETNA
NG102034379700GATON,WILFREDO6/1/2026
$228.08
BROKER SOCIETY INSURANCE
HUMANA
00026545711K_HMOPABLO ROBLES6/1/2026
$455.58
BROKER SOCIETY INSURANCE
HUMANA
00026545711K_HMOPABLO ROBLES6/1/2026
-$228.08
BROKER SOCIETY INSURANCE
HUMANA
00025842914K_PPOLUIS ARROYO M
6/1/2026
$120.00
BROKER SOCIETY INSURANCE
UNITED HEALTH CARE
HRA
BETHZAIDA VAZQUEZ
-$50.00
BROKER SOCIETY INSURANCE
UNITED HEALTH CARE
957226497CORTES GONZALES, RAMON01/01/2026-$180.00
BROKER SOCIETY INSURANCE
UNITED HEALTH CARE
906422581RODRIGUEZ, GUILLERMO01/01/2026-$202.41
Balance:$1,305.59
`;

describe('bsiPayeeCompensationStatement', () => {
  it('detects payee compensation PDFs (not carrier-section BSI PDFs)', () => {
    expect(isBsiPayeeCompensationStatement(JULY_TEXT, 'Commission_Statement_-8_6_26.pdf')).toBe(true);
    expect(isBsiPayeeCompensationStatement(JUNE_TEXT, 'CarrierStatement-June__Lina__.pdf')).toBe(true);
    expect(
      isBsiPayeeCompensationStatement(
        'Detailed Compensation Statement (UHC)\nBROKER SOCIETY INSURANCE',
        'bsi.pdf'
      )
    ).toBe(false);
  });

  it('splits glued UHC / Humana / Aetna policies', () => {
    expect(splitPolicyClient('917999971GUERRA, ROSA')).toEqual({
      policyNumber: '917999971',
      clientName: 'GUERRA, ROSA',
    });
    expect(splitPolicyClient('00017418524K_PPOMARIAD JUAREZ GRANADOS')).toEqual({
      policyNumber: '00017418524K_PPO',
      clientName: 'MARIAD JUAREZ GRANADOS',
    });
    expect(splitPolicyClient('NG102227785800MONTES DE TRIGUEROS,M')).toEqual({
      policyNumber: 'NG102227785800',
      clientName: 'MONTES DE TRIGUEROS,M',
    });
  });

  it('parses July Alba statement period and lines', () => {
    const result = parseBsiPayeeCompensationStatement(JULY_TEXT, {
      filename: 'Commission_Statement_-8_6_26.pdf',
      agentName: 'Alba Hernandez',
    });
    expect(result.period).toBe('202607');
    expect(result.statedBalance).toBe(2390.1);
    expect(result.records.length).toBe(14);
    expect(result.commissionSum).toBe(2290.1);
    expect(result.records.every((r) => r.source === 'BSI_PAYEE')).toBe(true);
    expect(result.records.every((r) => r.producerPayable === r.commission)).toBe(true);
    expect(result.records.every((r) => r.theiShare === 0 && r.bsiShare === 0)).toBe(true);
    const guerra = result.records.find((r) => r.policyNumber === '917999971');
    expect(guerra.client).toMatch(/GUERRA/i);
    expect(guerra.classification).toBe('New Business');
    expect(guerra.producerPayable).toBe(694);
    const hra = result.records.find((r) => r.policyNumber === 'HRA');
    expect(hra.producerPayable).toBe(-50);
    expect(hra.classification).toBe('Chargeback');
  });

  it('parses June statement from filename when title omitted', () => {
    const result = parseBsiPayeeCompensationStatement(JUNE_TEXT, {
      filename: 'CarrierStatement-June__Lina___1__.pdf',
      agentName: 'Alba Hernandez',
    });
    expect(result.period).toBe('202606');
    expect(result.statedBalance).toBe(1305.59);
    expect(result.records.length).toBe(15);
    expect(result.commissionSum).toBe(1095.59);
    const pablo = result.records.filter((r) => r.policyNumber === '00026545711K_HMO');
    expect(pablo.map((r) => r.producerPayable).sort((a, b) => a - b)).toEqual([-228.08, 455.58]);
    const hraJoe = result.records.find((r) => r.policyNumber === 'HRA' && /JOE|TEXAS/i.test(r.client));
    expect(hraJoe.producerPayable).toBe(-55);
  });

  it('periodFromText uses month before issue date as fallback', () => {
    expect(periodFromText('Date: 08/06/2026\nDetailed Compensation Statement', '', '08/06/2026')).toBe(
      '202607'
    );
  });
});
