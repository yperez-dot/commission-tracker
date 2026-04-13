const express = require('express');
const router = express.Router();
const { getPool } = require('../db/database');
const { requireAuth } = require('./auth');

const AGENT_ALIASES = {
  // Yahoska Perez
  'yahoska g perez': 'Yahoska Perez',
  'yahoska g. perez': 'Yahoska Perez',
  'yahoska perez': 'Yahoska Perez',
  'perez yahoska g': 'Yahoska Perez',
  'perez, yahoska g': 'Yahoska Perez',
  'yahoska g perez': 'Yahoska Perez',

  // Katy Robles
  'katy jullie robles': 'Katy Robles',
  'robles, katy jullie': 'Katy Robles',
  'robles katy j': 'Katy Robles',
  'robles, katy j': 'Katy Robles',
  'robles, katy': 'Katy Robles',
  'robles katy': 'Katy Robles',
  'katy robles': 'Katy Robles',
  'katy jullie robles': 'Katy Robles',

  // Carolina Robles (different person)
  'robles, carolina andrea': 'Carolina Robles',
  'carolina robles': 'Carolina Robles',

  // Gina Berenguer
  'berenguer gina f': 'Gina Berenguer',
  'berenguer, gina ferro': 'Gina Berenguer',
  'berenguer, gina f': 'Gina Berenguer',
  'gina berenguer': 'Gina Berenguer',

  // Jill Taylor
  'jill ann taylor': 'Jill Taylor',
  'taylor jill a': 'Jill Taylor',
  'taylor, jill ann': 'Jill Taylor',
  'jill a taylor': 'Jill Taylor',
  'jill taylor': 'Jill Taylor',
  'taylor, jill a': 'Jill Taylor',
  'taylor jill ann': 'Jill Taylor',

  // Osmary Orozco
  'orozco, osmary': 'Osmary Orozco',
  'orozco osmary': 'Osmary Orozco',
  'osmary orozco': 'Osmary Orozco',

  // Sabri Perez
  'sabri perez': 'Sabri Perez',
  'sabri uriel perez': 'Sabri Perez',
  'perez, sabri uriel': 'Sabri Perez',
  'perez sabri uriel': 'Sabri Perez',

  // The Health Experts Insurance (agency)
  'the health experts insurance': 'The Health Experts Insurance',
  'health experts insurance': 'The Health Experts Insurance',

  // Christian Munoz
  'munoz, christian': 'Christian Munoz',
  'munoz christian': 'Christian Munoz',
  'christian munoz': 'Christian Munoz',

  // Paulette Rostran
  'rostran, paulette': 'Paulette Rostran',
  'paulette rostran': 'Paulette Rostran',

  // Yamile Dominguez
  'dominguez, yamile isabel': 'Yamile Dominguez',
  'yamile isabel dominguez': 'Yamile Dominguez',
  'dominguez, yamile': 'Yamile Dominguez',

  // Horacio Mendieta
  'mendieta, horacio g': 'Horacio Mendieta',
  'horacio g mendieta': 'Horacio Mendieta',
  'mendieta, horacio': 'Horacio Mendieta',
  'mendieta horacio g': 'Horacio Mendieta',

  // Jendy Vanheyningen
  'vanheyningen, jendy': 'Jendy Vanheyningen',
  'jendy vanheyningen': 'Jendy Vanheyningen',

  // Kelly Carpenter
  'carpenter, kelly elaine': 'Kelly Carpenter',
  'kelly elaine carpenter': 'Kelly Carpenter',
  'carpenter, kelly': 'Kelly Carpenter',

  // Diana Mejia
  'mejia, diana lucia': 'Diana Mejia',
  'diana lucia mejia': 'Diana Mejia',
  'mejia, diana': 'Diana Mejia',

  // Alba Hernandez
  'hernandez, alba': 'Alba Hernandez',
  'alba ritela hernandez': 'Alba Hernandez',
  'hernandez alba': 'Alba Hernandez',

  // Adrian Cruz
  'cruz, adrian brandon': 'Adrian Cruz',
  'adrian brandon cruz': 'Adrian Cruz',
  'cruz, adrian': 'Adrian Cruz',

  // Long Khuu
  'khuu, long bao': 'Long Khuu',
  'khuu, long': 'Long Khuu',
  'long bao khuu': 'Long Khuu',

  // Nicholas Mccalla
  'mccalla, nicholas george': 'Nicholas Mccalla',
  'mccalla, nicholas': 'Nicholas Mccalla',

  // Tyler Payton
  'payton, tyler duane duane': 'Tyler Payton',
  'payton, tyler duane': 'Tyler Payton',
  'tyler duane duane payton': 'Tyler Payton',
  'payton, tyler': 'Tyler Payton',

  // Edgar Piloto
  'piloto, edgar': 'Edgar Piloto',
  'mr. edgar piloto': 'Edgar Piloto',
  'edgar piloto': 'Edgar Piloto',

  // Michael Rivera
  'rivera, michael': 'Michael Rivera',
  'michael rivera': 'Michael Rivera',

  // Eric Del Valle
  'del valle, eric': 'Eric Del Valle',
  'eric del valle': 'Eric Del Valle',

  // Giancarlo De La Noval
  'de la noval, giancarlo': 'Giancarlo De La Noval',
  'giancarlo de la noval': 'Giancarlo De La Noval',

  // Tailored Insurance Solutions
  'tailored insurance solutions inc': 'Tailored Insurance Solutions',
  'tailored insurance solutions': 'Tailored Insurance Solutions',

  // Broker Society Insurance
  'broker society insurance': 'Broker Society Insurance',

  // Others
  'ayllon, alonso': 'Alonso Ayllon',
  'brewer, jena lynn': 'Jena Brewer',
  'jena lynn brewer': 'Jena Brewer',
  'mateo, michael': 'Michael Mateo',
  'miriam jimenez': 'Miriam Jimenez',
  'mr. eric perez': 'Eric Perez',
  'osle, miguel a': 'Miguel Osle',
  'patsy pernia': 'Patsy Pernia',
  'eduardo pernia': 'Eduardo Pernia',
  'perez, gabriel ali': 'Gabriel Perez',
  'portorreal, anthony': 'Anthony Portorreal',
  'anthony portorreal': 'Anthony Portorreal',
  'ivan santiago': 'Ivan Santiago',
  'alan elchami': 'Alan Elchami',
  'witcher, cristy': 'Cristy Witcher',
  'cristy l witcher': 'Cristy Witcher',
  'yes c holdings,': 'Yes C Holdings',
  'viviana j cortes': 'Viviana Cortes',
  'giselle lopez': 'Giselle Lopez',
  'jessica sifontes': 'Jessica Sifontes',
  'josseline silber': 'Josseline Silber',
};

function normalizeAgentName(name) {
  if (!name) return name;
  const key = name.toLowerCase().trim();
  if (AGENT_ALIASES[key]) return AGENT_ALIASES[key];
  return toTitleCase(name);
}

function toTitleCase(name) {
  if (!name) return name;
  const trimmed = name.trim();
  if (trimmed === trimmed.toUpperCase() || trimmed === trimmed.toLowerCase()) {
    if (trimmed.includes(',')) {
      const parts = trimmed.split(',').map(p => p.trim());
      if (parts.length === 2) {
        const last = titleCaseWord(parts[0]);
        const first = titleCaseWord(parts[1]);
        return `${first} ${last}`;
      }
    }
    return trimmed.split(' ').map(titleCaseWord).join(' ');
  }
  return trimmed;
}

function titleCaseWord(word) {
  if (!word) return word;
  return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
}

router.get('/agents', requireAuth, async (req, res) => {
  try {
    const pool = getPool();
    const result = await pool.query(
      `SELECT DISTINCT agent_name, COUNT(*) as record_count
       FROM commission_records
       WHERE agent_name IS NOT NULL AND agent_name != ''
       GROUP BY agent_name
       ORDER BY agent_name`
    );
    const agents = result.rows.map(row => ({
      original: row.agent_name,
      canonical: normalizeAgentName(row.agent_name),
      record_count: parseInt(row.record_count),
      needs_fix: normalizeAgentName(row.agent_name) !== row.agent_name
    }));
    res.json(agents);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/normalize-all', requireAuth, async (req, res) => {
  try {
    const pool = getPool();
    const result = await pool.query(
      `SELECT DISTINCT agent_name FROM commission_records WHERE agent_name IS NOT NULL`
    );
    let updated = 0;
    let skipped = 0;
    for (const row of result.rows) {
      const canonical = normalizeAgentName(row.agent_name);
      if (canonical !== row.agent_name) {
        await pool.query(
          `UPDATE commission_records SET agent_name = $1 WHERE agent_name = $2`,
          [canonical, row.agent_name]
        );
        await pool.query(
          `UPDATE book_of_business SET agent_name = $1 WHERE agent_name = $2`,
          [canonical, row.agent_name]
        ).catch(() => {});
        updated++;
      } else {
        skipped++;
      }
    }
    res.json({ updated, skipped, total: updated + skipped });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

router.post('/alias', requireAuth, async (req, res) => {
  try {
    const pool = getPool();
    const { from, to } = req.body;
    if (!from || !to) return res.status(400).json({ error: 'from and to required' });
    const result = await pool.query(
      `UPDATE commission_records SET agent_name = $1 WHERE agent_name = $2`,
      [to, from]
    );
    await pool.query(
      `UPDATE book_of_business SET agent_name = $1 WHERE agent_name = $2`,
      [to, from]
    ).catch(() => {});
    res.json({ updated: result.rowCount, from, to });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
module.exports.normalizeAgentName = normalizeAgentName;
