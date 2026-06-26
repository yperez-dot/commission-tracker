const nodemailer = require('nodemailer');
const fs = require('fs');

const transporter = nodemailer.createTransport({
  host: 'smtp.gmail.com',
  port: 587,
  secure: false,
  auth: {
    user: 'info@healthexps.com',
    pass: 'dgmqjjejribmjyoy'
  }
});

const summary = fs.readFileSync('STATUS_FILTER_FIXES_SUMMARY.md', 'utf8');

const mailOptions = {
  from: '"Igor (THEI AI)" <info@healthexps.com>',
  to: 'yperez@healthexps.com',
  subject: '✅ Status Filter Fixes Complete - UHC MA 287/137 Validated',
  text: summary,
  html: `<pre style="font-family: monospace; font-size: 14px; line-height: 1.5;">${summary.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</pre>`
};

transporter.sendMail(mailOptions, (error, info) => {
  if (error) {
    console.error('❌ Email failed:', error);
    process.exit(1);
  } else {
    console.log('✅ Email sent:', info.response);
    console.log('📧 Sent to: yperez@healthexps.com');
    process.exit(0);
  }
});
