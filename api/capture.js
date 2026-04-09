export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ message: 'Method Not Allowed' });
    }

    const { source, payload, timestamp } = req.body;
    const logTime = new Date().toISOString();

    // 1. LOG TO VERCEL CONSOLE (Persistent)
    console.log(`[LEAD CAPTURE] [${logTime}]`);
    console.log(`SOURCE: ${source}`);
    console.log(`PAYLOAD:`, JSON.stringify(payload, null, 2));
    console.log('------------------------------------------------');

    // 2. (Optional Future) Save to DB or Send Slack/Email
    // await saveToDatabase(payload);

    return res.status(200).json({ status: 'captured', id: Date.now() });
}
