// Vercel Serverless Function for Claude API
// Analyzes tally reports (text or images) using Claude

export default async function handler(req, res) {
    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const apiKey = process.env.CLAUDE_API_KEY;
    if (!apiKey) {
        return res.status(500).json({ error: 'Claude API key not configured' });
    }

    try {
        const { type, content, imageBase64, mimeType } = req.body;

        // Build the prompt for tally analysis
        const systemPrompt = `You are an expert at analyzing shipping tally reports and discharge documents.
Extract the following information and return it as valid JSON only (no markdown, no explanation):

{
    "date": "DD/MM/YYYY",
    "shifts": [
        {
            "name": "Shift 1",
            "time": "07:00-15:00",
            "gangs": "1-2",
            "cargo": [
                {
                    "type": "Steel coils",
                    "quantity": 150,
                    "weight": 2450
                }
            ],
            "quantity": 150,
            "weight": 2450
        }
    ],
    "totalQuantity": 330,
    "totalWeight": 5340,
    "remarks": ["Rain stopped operations 14:30-15:15", "Crane breakdown 10:00-10:30"]
}

Rules:
- Weights should be in MT (metric tons)
- If quantity is not specified, use 0
- Extract ALL remarks, events, stoppages, delays, weather issues
- Date format: DD/MM/YYYY
- If information is missing, use null
- Return ONLY valid JSON, nothing else`;

        let messages = [];

        if (type === 'image' && imageBase64) {
            // Image analysis with Claude Vision
            messages = [
                {
                    role: 'user',
                    content: [
                        {
                            type: 'image',
                            source: {
                                type: 'base64',
                                media_type: mimeType || 'image/jpeg',
                                data: imageBase64
                            }
                        },
                        {
                            type: 'text',
                            text: 'Analyze this tally/discharge report image and extract all the data. Return JSON only.'
                        }
                    ]
                }
            ];
        } else if (type === 'text' && content) {
            // Text analysis
            messages = [
                {
                    role: 'user',
                    content: `Analyze this tally/discharge report and extract all the data. Return JSON only.\n\n${content}`
                }
            ];
        } else {
            return res.status(400).json({ error: 'Invalid request: provide either text content or image' });
        }

        // Call Claude API
        const response = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': apiKey,
                'anthropic-version': '2023-06-01'
            },
            body: JSON.stringify({
                model: 'claude-sonnet-4-20250514',
                max_tokens: 4096,
                system: systemPrompt,
                messages: messages
            })
        });

        if (!response.ok) {
            const errorData = await response.text();
            console.error('Claude API error:', errorData);
            return res.status(response.status).json({
                error: 'Claude API error',
                details: errorData
            });
        }

        const data = await response.json();

        // Extract the text content from Claude's response
        const textContent = data.content.find(c => c.type === 'text');
        if (!textContent) {
            return res.status(500).json({ error: 'No text response from Claude' });
        }

        // Try to parse as JSON
        let parsedData;
        try {
            // Remove any markdown code blocks if present
            let jsonText = textContent.text.trim();
            if (jsonText.startsWith('```')) {
                jsonText = jsonText.replace(/```json?\n?/g, '').replace(/```$/g, '').trim();
            }
            parsedData = JSON.parse(jsonText);
        } catch (parseError) {
            // If JSON parsing fails, return the raw text
            return res.status(200).json({
                success: true,
                raw: textContent.text,
                parsed: null,
                message: 'Could not parse as JSON, returning raw analysis'
            });
        }

        return res.status(200).json({
            success: true,
            parsed: parsedData
        });

    } catch (error) {
        console.error('Server error:', error);
        return res.status(500).json({
            error: 'Server error',
            message: error.message
        });
    }
}
