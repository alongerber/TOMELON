// Vercel Serverless Function for Claude AI Analysis
// Unified endpoint for all parsing: emails, tally reports, images

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

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
        return res.status(500).json({ error: 'Claude API key not configured. Add ANTHROPIC_API_KEY to Vercel Environment Variables.' });
    }

    try {
        const { parseType, content, imageBase64, mimeType, existingShips } = req.body;

        let systemPrompt = '';
        let userPrompt = '';

        // Different prompts based on parse type
        if (parseType === 'email' || parseType === 'message') {
            systemPrompt = `You are an expert shipping operations assistant. Analyze emails, WhatsApp messages, and communications about vessel operations.

Extract ANY relevant shipping information you find. Be flexible with formats - the data can come in many variations and languages (English, Hebrew, Chinese, etc.).

Return valid JSON only (no markdown, no explanation):

{
    "vesselName": "string or null - the ship/vessel name (look for MV, M/V, M.V, VSL, VESSEL, ship names)",
    "eta": "string or null - Expected Time of Arrival (any date/time format found)",
    "etb": "string or null - Expected Time of Berthing",
    "etd": "string or null - Expected Time of Departure",
    "ets": "string or null - Expected Time of Sailing",
    "port": "string or null - port name (Ashdod, Haifa, Shipyards, etc. - handle typos like 'Ahsdod')",
    "status": "string or null - vessel status if mentioned",
    "cargo": {
        "type": "string or null - cargo type",
        "quantity": "number or null",
        "weight": "number or null - in MT"
    },
    "services": {
        "water": "boolean - fresh water supply needed",
        "bunker": "boolean - fuel/bunker needed",
        "crewChange": "boolean - crew change mentioned",
        "provisions": "boolean - provisions/stores needed",
        "sludge": "boolean - sludge disposal",
        "repairs": "boolean - any repairs mentioned",
        "other": ["array of other services mentioned"]
    },
    "agent": "string or null - agent name if mentioned",
    "notes": ["array of important notes, instructions, or remarks"],
    "contacts": [
        {
            "name": "string",
            "role": "string (captain, agent, operator, etc.)",
            "email": "string or null",
            "phone": "string or null"
        }
    ],
    "confidence": "high/medium/low - how confident you are in the extraction"
}

Rules:
- Extract EVERYTHING relevant, even partial information
- Handle typos and variations (Ahsdod = Ashdod, etc.)
- Dates can be in any format - preserve as found
- Look for vessel names after: MV, M/V, M.V., M.V, VSL, VESSEL, master of, captain of
- Israeli ports: Ashdod, Haifa, Haifa Bay Port, Shipyards Port, מספנות, נמל המפרץ
- Services: water, fresh water, bunker, fuel, crew change, provisions, stores, sludge, repairs
- Return ONLY valid JSON`;

            userPrompt = content;

            // Add context about existing ships if provided
            if (existingShips && existingShips.length > 0) {
                systemPrompt += `\n\nExisting ships in the system (try to match vessel names): ${existingShips.join(', ')}`;
            }

        } else if (parseType === 'tally') {
            systemPrompt = `You are an expert at analyzing shipping tally reports and discharge documents.

Extract discharge/loading operation data. Handle various formats and languages.

Return valid JSON only (no markdown, no explanation):

{
    "date": "DD/MM/YYYY or as found",
    "shifts": [
        {
            "name": "Shift 1/2/3 or time period",
            "time": "time range if specified",
            "gangs": "gang numbers if specified",
            "cargo": [
                {
                    "type": "cargo type",
                    "quantity": 0,
                    "weight": 0
                }
            ],
            "quantity": 0,
            "weight": 0
        }
    ],
    "totalQuantity": 0,
    "totalWeight": 0,
    "remarks": ["all remarks, events, stoppages, delays, weather issues"],
    "vesselName": "vessel name if found",
    "port": "port if found"
}

Rules:
- Weights in MT (metric tons)
- Extract ALL remarks and events
- If no shifts structure, create one "Total" entry
- Return ONLY valid JSON`;

            userPrompt = `Analyze this tally/discharge report:\n\n${content}`;
        } else {
            return res.status(400).json({ error: 'Invalid parseType. Use "email", "message", or "tally"' });
        }

        // Build messages array
        let messages = [];

        if (imageBase64) {
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
                            text: userPrompt || 'Extract all shipping information from this image. Return JSON only.'
                        }
                    ]
                }
            ];
        } else if (content) {
            messages = [
                {
                    role: 'user',
                    content: userPrompt
                }
            ];
        } else {
            return res.status(400).json({ error: 'Provide either text content or image' });
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
            let jsonText = textContent.text.trim();
            // Remove markdown code blocks if present
            if (jsonText.startsWith('```')) {
                jsonText = jsonText.replace(/```json?\n?/g, '').replace(/```\s*$/g, '').trim();
            }
            parsedData = JSON.parse(jsonText);
        } catch (parseError) {
            console.error('JSON parse error:', parseError, 'Raw:', textContent.text);
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
