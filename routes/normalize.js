const AGENT_ALIASES = {
  'yahoska g perez': 'Yahoska Perez',
  'perez, yahoska g': 'Yahoska Perez',
  'perez yahoska g': 'Yahoska Perez',
  'yahoska perez': 'Yahoska Perez',
  'yahoska g. perez': 'Yahoska Perez',

  'robles, katy jullie': 'Katy Robles',
  'robles katy jullie': 'Katy Robles',
  'robles katy j': 'Katy Robles',
  'robles, katy': 'Katy Robles',
  'katy jullie robles': 'Katy Robles',
  'katy robles': 'Katy Robles',
  'robles, katy j': 'Katy Robles',

  // Carolina Robles is a separate person (THEI ops/retention, not Katy)
  'robles, carolina andrea': 'Carolina Robles',
  'carolina andrea robles': 'Carolina Robles',
  'robles, carolina': 'Carolina Robles',
  'carolina robles': 'Carolina Robles',

  'taylor, jill ann': 'Jill Taylor',
  'taylor jill a': 'Jill Taylor',
  'jill a taylor': 'Jill Taylor',
  'jill ann taylor': 'Jill Taylor',
  'jill taylor': 'Jill Taylor',
  'taylor, jill a': 'Jill Taylor',

  'berenguer, gina ferro': 'Gina Berenguer',
  'berenguer gina f': 'Gina Berenguer',
  'gina berenguer': 'Gina Berenguer',
  'berenguer, gina': 'Gina Berenguer',
  'gina ferro berenguer': 'Gina Berenguer', // NHP uses full name with middle name

  'orozco, osmary': 'Osmary Orozco',
  'orozco osmary': 'Osmary Orozco',
  'osmary orozco': 'Osmary Orozco',

  'perez, sabri uriel': 'Sabri Perez',
  'sabri uriel perez': 'Sabri Perez',
  'sabri perez': 'Sabri Perez',

  'health experts': 'The Health Experts Insurance',
  'the health experts': 'The Health Experts Insurance',
  'health experts insurance': 'The Health Experts Insurance',
  'the health experts insurance': 'The Health Experts Insurance',
  'the health experts insurance inc': 'The Health Experts Insurance',

  'rostran, paulette': 'Paulette Rostran',
  'paulette rostran': 'Paulette Rostran',

  'dominguez, yamile isabel': 'Yamile Dominguez',
  'dominguez, yamile': 'Yamile Dominguez',
  'yamile isabel dominguez': 'Yamile Dominguez',

  'mendieta, horacio g': 'Horacio Mendieta',
  'mendieta, horacio': 'Horacio Mendieta',
  'horacio g mendieta': 'Horacio Mendieta',

  'vanheyningen, jendy': 'Jendy Vanheyningen',
  'jendy vanheyningen': 'Jendy Vanheyningen',

  'rivera, michael': 'Michael Rivera',
  'michael rivera': 'Michael Rivera',

  'piloto, edgar': 'Edgar Piloto',
  'mr. edgar piloto': 'Edgar Piloto',
  'edgar piloto': 'Edgar Piloto',

  'cruz, adrian brandon': 'Adrian Cruz',
  'cruz, adrian': 'Adrian Cruz',
  'adrian brandon cruz': 'Adrian Cruz',

  'carpenter, kelly elaine': 'Kelly Carpenter',
  'carpenter, kelly': 'Kelly Carpenter',
  'kelly elaine carpenter': 'Kelly Carpenter',

  'mejia, diana lucia': 'Diana Mejia',
  'mejia, diana': 'Diana Mejia',
  'diana lucia mejia': 'Diana Mejia',

  'hernandez, alba ritela': 'Alba Hernandez',
  'hernandez, alba': 'Alba Hernandez',
  'alba ritela hernandez': 'Alba Hernandez',

  'payton, tyler duane duane': 'Tyler Payton',
  'payton, tyler duane': 'Tyler Payton',
  'tyler duane duane payton': 'Tyler Payton',
  'tyler duane payton': 'Tyler Payton',

  'mccalla, nicholas george': 'Nicholas Mccalla',
  'mccalla, nicholas': 'Nicholas Mccalla',
  'nicholas george mccalla': 'Nicholas Mccalla',

  'de la noval, giancarlo': 'Giancarlo De La Noval',
  'giancarlo de la noval': 'Giancarlo De La Noval',

  'del valle, eric': 'Eric Del Valle',
  'eric del valle': 'Eric Del Valle',

  'brewer, jena lynn': 'Jena Brewer',
  'jena lynn brewer': 'Jena Brewer',

  'witcher, cristy': 'Cristy Witcher',
  'cristy l witcher': 'Cristy Witcher',

  'portorreal, anthony': 'Anthony Portorreal',
  'anthony portorreal': 'Anthony Portorreal',

  'munoz, christian': 'Christian Munoz',
  'christian munoz': 'Christian Munoz',

  // 'broker society insurance' alias intentionally removed 2026-07-07 per Yahoska:
  // BSI agency-level production must stay separate from Alba's individual totals.
  // BSI rows will remain as 'Broker Society Insurance' until further decision.

  'tailored insurance solutions inc': 'Tailored Insurance Solutions',
  'tailored insurance solutions': 'Tailored Insurance Solutions',

  'yes c holdings,': 'Yes C Holdings',
  'yes c holdings': 'Yes C Holdings',

  'khuu, long bao': 'Long Khuu',
  'khuu, long': 'Long Khuu',
  'long bao khuu': 'Long Khuu',

  'osle, miguel a': 'Miguel Osle',
  'ayllon, alonso': 'Alonso Ayllon',
  'mateo, michael': 'Michael Mateo',
  'perez, gabriel ali': 'Gabriel Perez',
  'mr. eric perez': 'Eric Perez',
  'ivan santiago': 'Ivan Santiago',
  'miriam jimenez': 'Miriam Jimenez',
  'alan elchami': 'Alan Elchami',
  'patsy pernia': 'Patsy Pernia',
  'eduardo pernia': 'Eduardo Pernia',
  'jessica sifontes': 'Jessica Sifontes',
  'viviana j cortes': 'Viviana Cortes',
  'giselle lopez': 'Giselle Lopez',
  'josseline silber': 'Josseline Silber',
  'agent': 'Unknown Agent',
};

function toTitleCase(str) {
  return str.toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
}

function convertLastFirstToFirstLast(name) {
  if (name.includes(',')) {
    const parts = name.split(',').map(p => p.trim());
    if (parts.length === 2) {
      return `${toTitleCase(parts[1])} ${toTitleCase(parts[0])}`;
    }
  }
  if (name === name.toUpperCase() && name.length > 2) {
    return toTitleCase(name);
  }
  return name;
}

function normalizeAgentName(raw) {
  if (!raw) return raw;
  // Collapse multiple spaces to single space
  const cleaned = raw.trim().replace(/\s+/g, ' ');
  const key = cleaned.toLowerCase();
  return AGENT_ALIASES[key] || convertLastFirstToFirstLast(cleaned);
}

async function normalizeAllRecords(pool) {
  const records = await pool.query('SELECT id, agent_name FROM commission_records');
  let updated = 0;
  for (const rec of records.rows) {
    const normalized = normalizeAgentName(rec.agent_name);
    if (normalized !== rec.agent_name) {
      await pool.query('UPDATE commission_records SET agent_name = $1 WHERE id = $2', [normalized, rec.id]);
      updated++;
    }
  }
  const bob = await pool.query('SELECT id, agent_name FROM book_of_business');
  for (const rec of bob.rows) {
    const normalized = normalizeAgentName(rec.agent_name);
    if (normalized !== rec.agent_name) {
      await pool.query('UPDATE book_of_business SET agent_name = $1 WHERE id = $2', [normalized, rec.id]);
    }
  }

  // Also normalize policy_status so is_termed EXISTS checks match correctly
  const ps = await pool.query('SELECT id, agent_name FROM policy_status');
  for (const rec of ps.rows) {
    const normalized = normalizeAgentName(rec.agent_name);
    if (normalized !== rec.agent_name) {
      await pool.query('UPDATE policy_status SET agent_name = $1 WHERE id = $2', [normalized, rec.id]);
    }
  }

  return updated;
}

module.exports = { normalizeAgentName, AGENT_ALIASES, normalizeAllRecords };
