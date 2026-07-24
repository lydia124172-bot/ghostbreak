#!/usr/bin/env node
/**
 * Generate public/downloads/survival-guide.pdf (English, built-in Helvetica)
 */
const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');

const OUT_DIR = path.join(__dirname, '..', 'public', 'downloads');
const OUT_FILE = path.join(OUT_DIR, 'survival-guide.pdf');

const GUIDE_CONTENT = {
  subtitle: 'A recovery handbook for yourself after the message is sent',
  intro: [
    'Dear client,',
    '',
    'The moment you pressed "Send," you completed something extraordinarily difficult—you drew a line under a relationship and entrusted your final words to the system to deliver on your behalf. That courage deserves to be honored.',
    '',
    'The Emotional Detox Survival Guide is an exclusive bonus included with GhostBreak\'s Premium Full Package. It is designed to help you stabilize your emotions and rebuild your daily rhythm during the 7–30 days after your message goes out, so you are less likely to make decisions you will regret during a vulnerable period.',
    '',
    'This guide is not a substitute for professional mental health treatment. If you experience persistent insomnia, sudden changes in appetite, an inability to work, or thoughts of self-harm, please seek professional counseling or medical help immediately.',
    '',
    'Suggested use: read one chapter per day and complete the "Today\'s Practice" at the end. You do not need to finish the guide in one sitting—give yourself time.',
  ],
  chapters: [
    {
      title: 'Chapter 1 | Accepting the Period: The Message Is Sent, the Ritual Is Complete',
      sections: [
        {
          heading: 'Why do you feel empty afterward?',
          body: [
            'After a breakup letter or text is sent, many people experience a "post-task vacuum." This is not weakness—it is a normal response as your brain releases from a prolonged state of high alert. You may feel relief, anxiety, regret, or a strange calm all at once. These emotions can coexist.',
            'Remember: you chose anonymous delivery to protect both people\'s dignity and to avoid causing more harm through direct conversation at an emotional peak. That is a responsible decision for both of you.',
          ],
        },
        {
          heading: 'Three steps to complete the ritual',
          body: [
            '1. Write one sentence: "I have said what needed to be said." It does not need to be perfect—only honest.',
            '2. Close any tabs and drafts related to this delivery as a symbol that the handoff is complete.',
            '3. Do one small thing unrelated to the relationship: take a shower, tidy your desk, or step out for a drink—let your body know that a chapter has closed today.',
          ],
        },
        {
          heading: "Today's Practice",
          body: [
            'On paper, write down three moments when you are grateful for your own courage (they do not need to be about romance). Reread them before bed.',
          ],
        },
      ],
    },
    {
      title: 'Chapter 2 | Emotional First Aid: Getting Through the First 72 Hours',
      sections: [
        {
          heading: 'The cycle of emotional waves',
          body: [
            'In the first 72 hours after a breakup, emotions often arrive like waves—surging and receding. You may feel the urge every few hours to check whether the other person has read your message, replied, or is angry. This is a withdrawal response; it does not mean you did something wrong.',
            'GhostBreak was designed so you do not have to keep reopening the chat box, deleting and rewriting during this period. Your message is on its way or has already been delivered—redirect the impulse to "wait for a response" into care for yourself.',
          ],
        },
        {
          heading: 'When the urge hits (the STOP method)',
          body: [
            'S — Stop: pause. Do not immediately text, call, or scroll social media.',
            'T — Take a breath: breathe deeply four times—in for 4 seconds, hold for 2, out for 6.',
            'O — Observe: notice physical sensations (tight chest, lump in the throat, sweaty palms) without judging them.',
            'P — Proceed: choose an alternative action—walk for 10 minutes, drink warm water, message a friend (without rehashing the ex), or journal.',
          ],
        },
        {
          heading: 'Sleep and nutrition',
          body: [
            'When emotions run high, sleep quality often drops. If you struggle to fall asleep, avoid using alcohol as a sleep aid—it can worsen mood swings. Try a consistent bedtime, no phone for an hour before sleep, a slightly cool room, and white noise or soft music.',
            'Even if you have little appetite, maintain basic meals. Low blood sugar amplifies anxiety. A simple bowl of noodles or a piece of fruit is still an act of care.',
          ],
        },
        {
          heading: "Today's Practice",
          body: [
            'Set three alarms (morning, midday, evening). When each sounds, do only one thing: take a sip of water and breathe deeply three times.',
          ],
        },
      ],
    },
    {
      title: 'Chapter 3 | Digital Detox: Stepping Away from "Surveillance Nostalgia"',
      sections: [
        {
          heading: 'Why we do not recommend blocking or deleting immediately',
          body: [
            'Many guides advise "block right away," but for some people an abrupt cut-off triggers stronger panic and rebound urges. A gentler approach is temporary archiving: move the person\'s contact to an archive folder, mute notifications, and log out of shared accounts rather than deleting permanently.',
            'The goal is not to punish the other person—it is to reduce how often you passively receive information and give your brain room to heal.',
          ],
        },
        {
          heading: 'Social media boundaries',
          body: [
            'For the first 7 days: do not actively check the other person\'s posts, stories, or indirect updates through mutual friends.',
            'If the algorithm keeps surfacing their content, use "See less," "Not interested," or temporarily disable the app.',
            'Do not post vague or suggestive updates to test their reaction—this usually prolongs pain rather than delivering the answer you hope for.',
            'If you must share a work group or family chat, mute it and limit yourself to one fixed check-in time per day.',
          ],
        },
        {
          heading: 'Handling the temptation to reply',
          body: [
            'If the other person reaches out after your message was delivered on your behalf, do not reply immediately. Give yourself at least 24 hours, use the STOP method from Chapter 2, and then decide whether to respond.',
            'If you have already completed your final notice through GhostBreak, repeating explanations rarely changes the outcome—it only pulls both of you back into the same cycle.',
          ],
        },
        {
          heading: "Today's Practice",
          body: [
            'Archive or export chat history related to your ex, then remove shortcuts from your home screen. Note how you feel afterward—you do not need to share it with anyone.',
          ],
        },
      ],
    },
    {
      title: 'Chapter 4 | Rebuilding Boundaries: Reclaiming Your Energy',
      sections: [
        {
          heading: 'What are healthy boundaries?',
          body: [
            'Boundaries are not coldness—they clarify what you are willing to give and what you need to protect. After a breakup, you have the right to stop carrying the other person\'s emotional labor, stop re-explaining your decision, and stop taking full responsibility for their reactions.',
            'Anonymous delivery is itself a boundary: you fulfilled your duty to inform while protecting your contact privacy.',
          ],
        },
        {
          heading: 'Common boundary slips',
          body: [
            'Mutual friends relaying messages: "They\'re really upset—can you just text back?"—you may politely decline: "I\'ve already expressed myself. I need space right now."',
            'Holidays or anniversaries: you do not need to break boundaries you set just because the calendar says so.',
            'Returning belongings: meet in a public place or use a third party—avoid meeting alone.',
            'Requests for "one last time": if they ask to meet, call, or "talk it through," remember you already completed delivery through a formal channel.',
          ],
        },
        {
          heading: 'Promises to yourself',
          body: [
            'Write three commitments to yourself, for example:',
            '• I will not initiate contact for two weeks;',
            '• I will not ask mutual friends about their current situation;',
            '• I will schedule at least one activity each week that is only for me (exercise, a film, learning something new).',
            'Keep this note in your wallet or phone case and reread it when urges spike.',
          ],
        },
        {
          heading: "Today's Practice",
          body: [
            'List one interest you gave up to accommodate the other person, and schedule 30 minutes this week to reconnect with it.',
          ],
        },
      ],
    },
    {
      title: 'Chapter 5 | Self-Care: Your Body Is the Anchor for Your Emotions',
      sections: [
        {
          heading: 'Mind and body together',
          body: [
            'Grief and anxiety live not only in your mind—they show up as stiff shoulders, headaches, and stomach trouble. Caring for your body is the most practical entry point for stabilizing emotion.',
            'You do not need perfection. Start with a "minimum viable version": walk 15 minutes a day, stretch for 5 minutes, or soak your feet for 10.',
          ],
        },
        {
          heading: 'A suggested weekly rhythm',
          body: [
            'Monday–Friday: consistent wake time (within one hour), regular meals, and clear blocks for work or study versus rest.',
            'Weekends: plan one activity that is purely enjoyable—not to prove anything to anyone.',
            'Each night: three-line journal—one thing you are grateful you did for yourself, one hard thing, and one small goal for tomorrow.',
          ],
        },
        {
          heading: 'When to seek professional help',
          body: [
            'If any of the following persist for more than two weeks, consider booking therapy or seeing a mental health provider:',
            '• inability to sleep or sleeping more than 10 hours yet still feeling exhausted;',
            '• significant weight change or complete loss of appetite;',
            '• inability to complete normal work or school responsibilities;',
            '• recurring thoughts of self-harm or not wanting to live.',
            'Asking for help is strength, not failure. In the United States, call or text 988 for the Suicide & Crisis Lifeline (24 hours).',
          ],
        },
        {
          heading: "Today's Practice",
          body: [
            'Choose one area of your body (shoulders, lower back, around the eyes) and spend 3 minutes on gentle massage or a warm compress.',
          ],
        },
      ],
    },
    {
      title: 'Chapter 6 | Thirty-Day Detox Plan',
      sections: [
        {
          heading: 'Week 1 (Days 1–7): Stabilize and archive',
          body: [
            'Goal: reduce impulsive behavior and establish a basic daily rhythm.',
            '• Complete the daily practices from Chapters 1–3;',
            '• do not actively check the other person\'s social media;',
            '• log emotional intensity daily (0–10) and notice whether it eases over time;',
            '• if you receive a message from them, wait 24 hours before deciding whether to reply.',
          ],
        },
        {
          heading: 'Week 2 (Days 8–14): Rebuild your routine',
          body: [
            'Goal: shift attention from the relationship back to your own life.',
            '• return to an old hobby or try something new;',
            '• meet one trusted friend (you do not need to detail the breakup);',
            '• sort items connected to your ex and decide what to keep, donate, or discard;',
            '• review your Week 1 mood log and write one sentence: "I am more ______ than I was seven days ago."',
          ],
        },
        {
          heading: 'Week 3 (Days 15–21): Strengthen boundaries',
          body: [
            'Goal: reinforce limits and reduce rumination.',
            '• reread Chapter 4 and your three personal commitments;',
            '• if contact urges remain, write an unsent letter to release emotion;',
            '• assess whether work, social, or living environments need trigger adjustments;',
            '• plan a small celebration—completing three weeks of detox deserves recognition.',
          ],
        },
        {
          heading: 'Week 4 (Days 22–30): Look forward',
          body: [
            'Goal: integrate the experience and prepare for what comes next.',
            '• write three things this relationship taught you (you do not need to idealize the other person);',
            '• list three personal goals for the next three months (unrelated to romance);',
            '• decide whether to maintain no contact or only necessary communication;',
            '• thank yourself for completing these thirty days—you deserve gentleness.',
          ],
        },
      ],
    },
    {
      title: 'Chapter 7 | Moving Forward: Ending Is Not Failure',
      sections: [
        {
          heading: 'Redefining "the end"',
          body: [
            'Ending a relationship that no longer fits is not a mark against your life—it creates space for both people. Choosing GhostBreak for your final delivery means you still faced the other person with respect while protecting your privacy and emotional safety.',
            'Time will not erase every memory, but it can make memories bearable. You do not need to "forget" in order to move on—you only need the past to stop driving every choice in the present.',
          ],
        },
        {
          heading: 'To your future self',
          body: [
            'When you are ready for a new relationship, this experience will be part of your foundation: you know you can make responsible decisions under pressure, and you have tools to care for your emotions.',
            'Until then, reserve the most patience for yourself. Healing is not a straight line—a setback does not erase the progress you have already made.',
          ],
        },
        {
          heading: 'GhostBreak privacy commitment',
          body: [
            'This service delivers only the content you authorize. We do not disclose your real email or phone number to the recipient. Your order records are encrypted and available for status checks through your order confirmation email.',
            'If you have questions about your order or delivery status, contact support using the anonymous email you provided at checkout.',
          ],
        },
      ],
    },
    {
      title: 'Appendix | Quick Reference Checklist',
      sections: [
        {
          heading: 'Daily self-check (printable)',
          body: [
            '□ I ate regular meals today',
            '□ I had outdoor time or exercise for at least 10 minutes today',
            '□ I did not actively check the other person\'s social media today',
            '□ I did one thing today purely for myself',
            '□ When emotions peaked today, I used the STOP method',
            '□ If I cannot sleep tonight, I will put down my phone and try relaxed breathing',
          ],
        },
        {
          heading: 'Emergency resources (United States)',
          body: [
            '988 Suicide & Crisis Lifeline (24 hours—call or text 988)',
            'Crisis Text Line: text HOME to 741741 (24-hour SMS support)',
            'National Domestic Violence Hotline: 1-800-799-7233 (intimate partner violence)',
            'SAMHSA National Helpline: 1-800-662-4357 (mental health / substance use)',
            'For emergencies, dial 911',
          ],
        },
        {
          heading: 'Closing words',
          body: [
            'You have already taken the hardest step. For each day ahead, treat yourself the way you would treat a close friend.',
            '',
            'May you move forward with clarity, respect, and steadiness.',
            '',
            '— GhostBreak Anonymous Delivery Service',
          ],
        },
      ],
    },
  ],
};

function pickFont() {
  return 'Helvetica';
}

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function useFont(doc, fontPath) {
  doc.font(fontPath || 'Helvetica');
}

function needsPage(doc, height = 72) {
  return doc.y + height > doc.page.height - doc.page.margins.bottom;
}

function newPage(doc, fontPath) {
  doc.addPage();
  useFont(doc, fontPath);
}

function renderParagraph(doc, fontPath, text, { size = 11, color = '#333', gap = 6 } = {}) {
  const lines = String(text).split('\n');
  for (const line of lines) {
    if (needsPage(doc, size + gap + 20)) newPage(doc, fontPath);
    if (line === '') {
      doc.moveDown(0.4);
      continue;
    }
    doc.fillColor(color).fontSize(size).text(line, { align: 'left', lineGap: gap });
    doc.moveDown(0.2);
  }
}

function renderCover(doc, fontPath) {
  useFont(doc, fontPath);
  doc.fillColor('#5b21b6').fontSize(24).text('GhostBreak', { align: 'center' });
  doc.moveDown(0.6);
  doc.fillColor('#111').fontSize(22).text('Emotional Detox Survival Guide', { align: 'center' });
  doc.moveDown(0.4);
  doc.fillColor('#6b7280').fontSize(12).text(GUIDE_CONTENT.subtitle, { align: 'center' });
  doc.moveDown(1.2);
  doc.fillColor('#444').fontSize(11).text(GUIDE_CONTENT.intro.join('\n'), { align: 'left', lineGap: 7 });
}

function renderChapter(doc, fontPath, chapter) {
  if (needsPage(doc, 100)) newPage(doc, fontPath);
  else doc.moveDown(0.6);

  doc.fillColor('#5b21b6').fontSize(15).text(chapter.title, { underline: true });
  doc.moveDown(0.8);

  for (const section of chapter.sections) {
    if (needsPage(doc, 80)) newPage(doc, fontPath);
    doc.fillColor('#1f2937').fontSize(12).text(section.heading, { continued: false });
    doc.moveDown(0.4);
    for (const paragraph of section.body) {
      renderParagraph(doc, fontPath, paragraph, { size: 11, color: '#374151', gap: 5 });
      doc.moveDown(0.3);
    }
    doc.moveDown(0.5);
  }
}

function renderFooter(doc, fontPath) {
  newPage(doc, fontPath);
  doc.fillColor('#888').fontSize(9).text(
    `GhostBreak Official Guide · version ${new Date().toISOString().slice(0, 10)} · bafuholdings.com`,
    { align: 'center' },
  );
}

function writePdf() {
  ensureDir(OUT_DIR);
  const fontPath = pickFont();
  const doc = new PDFDocument({ margin: 56, size: 'A4' });
  const stream = fs.createWriteStream(OUT_FILE);
  doc.pipe(stream);

  renderCover(doc, fontPath);
  for (const chapter of GUIDE_CONTENT.chapters) {
    renderChapter(doc, fontPath, chapter);
  }
  renderFooter(doc, fontPath);

  doc.end();

  return new Promise((resolve, reject) => {
    stream.on('finish', () => resolve({ file: OUT_FILE, fontPath, pages: doc.bufferedPageRange().count }));
    stream.on('error', reject);
  });
}

writePdf()
  .then(({ file, fontPath }) => {
    const stat = fs.statSync(file);
    console.log('✅ Generated', file);
    console.log('   Font:', fontPath);
    console.log('   Size:', `${(stat.size / 1024).toFixed(1)} KB`);
  })
  .catch((err) => {
    console.error('❌ PDF generation failed:', err.message);
    process.exit(1);
  });
