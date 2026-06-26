const pdf = require('pdf-parse');
const fs = require('fs');

const pdfPath = '/home/medicare-ai-agent/.openclaw/media/inbound/Medicare_Statement-THE-April_1---a8d785cf-cf6b-47e8-b321-8e442081cbd5.pdf';

async function extractPaulLewis() {
  try {
    const dataBuffer = fs.readFileSync(pdfPath);
    const data = await pdf(dataBuffer);
    const text = data.text;
    
    // Split into lines
    const lines = text.split('\n');
    
    // Find lines with "Lewis" and "Paul"
    console.log('Lines containing "Lewis" and "Paul":\n');
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if ((line.includes('Lewis') || line.includes('LEWIS')) && 
          (line.includes('Paul') || line.includes('PAUL'))) {
        console.log(`Line ${i}: "${line}"`);
        
        // Show context (line before and after)
        if (i > 0) console.log(`  Prev: "${lines[i-1]}"`);
        if (i < lines.length - 1) console.log(`  Next: "${lines[i+1]}"`);
        console.log('---');
      }
    }
    
  } catch (err) {
    console.error('Error:', err.message);
  }
}

extractPaulLewis();
