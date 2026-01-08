// Vercel Serverless Function for AI Analysis
// Unified endpoint for all parsing: emails, tally reports, images

module.exports = async function handler(req, res) {
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
        return res.status(500).json({ error: 'API key not configured' });
    }

    try {
        const { parseType, content, imageBase64, mimeType, existingShips, currentYear } = req.body;

        let systemPrompt = '';
        let userPrompt = '';

        // Get current year for date parsing
        const year = currentYear || new Date().getFullYear();

        // Different prompts based on parse type
        if (parseType === 'email' || parseType === 'message') {
            systemPrompt = `You are an expert shipping operations assistant for an Israeli port agency. Analyze emails and WhatsApp messages about vessel operations.

IMPORTANT: Current year is ${year}. Use this for dates without year specified.

## STEP 1: Identify Message Type
Determine the message type based on content:
- NOMINATION: New vessel nomination, first contact about a ship coming
- ETA_UPDATE: Update to arrival time for a known vessel
- ARRIVAL_NOTICE: Vessel announcing imminent arrival (24hr/12hr/6hr notice)
- BERTHING_NOTICE: Vessel berthed or about to berth
- SAILING_NOTICE: Vessel sailed or about to sail
- SERVICE_REQUEST: Request for services (water, crew change, provisions, repairs)
- DOCUMENTS: Sending documents (BL, manifest, cargo list)
- DAILY_REPORT: Daily status report from captain
- CARGO_INFO: Cargo details, stowage plan, quantities
- DISCHARGE_REPORT: Tally report, discharge progress, cargo discharged/remaining quantities
- BULK_UPDATE: Multiple vessels with ETB/ETA dates (port schedule, berthing plan)
- OTHER: Doesn't fit above categories

## STEP 2: Extract All Relevant Fields

IMPORTANT: If message contains MULTIPLE vessels (like a port schedule or berthing list), set messageType to "BULK_UPDATE" and populate the "bulkVessels" array.

Return valid JSON only (no markdown, no explanation):

{
    "messageType": "NOMINATION|ETA_UPDATE|ARRIVAL_NOTICE|BERTHING_NOTICE|SAILING_NOTICE|SERVICE_REQUEST|DOCUMENTS|DAILY_REPORT|CARGO_INFO|DISCHARGE_REPORT|BULK_UPDATE|OTHER",
    "messageTypeConfidence": 0.95,

    "vesselName": "string - clean vessel name without MV/M.V prefix (for single vessel messages)",
    "vesselNameVariations": ["array of name variations found"],
    "imoNumber": "string or null - IMO number if found",
    "voyageNumber": "string or null",

    "bulkVessels": [
        {
            "vesselName": "string - vessel name",
            "etb": {
                "original": "string - as written",
                "iso": "YYYY-MM-DDTHH:mm:00"
            },
            "eta": {
                "original": "string or null",
                "iso": "string or null"
            },
            "berth": "string or null - berth number if specified"
        }
    ],

    "dates": {
        "eta": {
            "original": "string - exactly as written in message",
            "iso": "YYYY-MM-DDTHH:mm:00 - parsed to ISO format",
            "confidence": 0.95
        },
        "etb": {
            "original": "string or null",
            "iso": "string or null",
            "confidence": 0.0
        },
        "etd": {
            "original": "string or null",
            "iso": "string or null",
            "confidence": 0.0
        },
        "ets": {
            "original": "string or null",
            "iso": "string or null",
            "confidence": 0.0
        }
    },

    "ports": {
        "destination": "string - destination port (Ashdod/Haifa/Israel Shipyards/North Port/South Port)",
        "origin": "string or null - loading port",
        "lastPort": "string or null - last port of call",
        "nextPort": "string or null - next port after destination"
    },

    "status": {
        "current": "NOMINATED|LOADING|EN_ROUTE|AT_ANCHOR|BERTHED|WORKING|SAILED",
        "statusText": "string - original status text from message"
    },

    "cargo": {
        "types": [
            {
                "name": "string - cargo type",
                "weight": 0,
                "weightUnit": "MT",
                "quantity": 0,
                "quantityUnit": "pcs/units/coils/etc"
            }
        ],
        "totalWeight": 0,
        "totalQuantity": 0,
        "blNumbers": ["array of BL numbers"],
        "hasTelex": false,
        "remarks": "string or null"
    },

    "services": {
        "requested": [
            {
                "type": "WATER|PROVISIONS|CREW_CHANGE|REPAIRS|PARCELS|BUNKER|SLUDGE|OTHER",
                "details": "string - specific details",
                "quantity": "string or null - e.g., '50 tons'",
                "date": "string or null - requested date"
            }
        ]
    },

    "parties": {
        "owner": "string or null",
        "charterer": "string or null",
        "shipper": "string or null",
        "receiver": "string or null",
        "loadingAgent": "string or null",
        "nomination": "string or null - nominating party"
    },

    "contacts": [
        {
            "name": "string",
            "role": "CAPTAIN|OWNER|CHARTERER|AGENT|OPERATOR|SUPPLIER",
            "email": "string or null",
            "phone": "string or null",
            "company": "string or null"
        }
    ],

    "vessel": {
        "flag": "string or null",
        "draft": "number or null - in meters",
        "loa": "number or null - length overall",
        "beam": "number or null"
    },

    "notes": ["array of important notes or remarks from the message"],

    "extractionConfidence": 0.9
}

## Date Parsing Rules:
- "9th Jan" / "Jan 9" / "09/01" / "09.01" → ${year}-01-09
- "9th Jan 2026" / "09/01/2026" → 2026-01-09
- Time: "0700lt" / "07:00 LT" / "0700hrs" → T07:00:00
- If no time specified, use T00:00:00
- If date is ambiguous (e.g., 01/02), prefer DD/MM format
- Always output ISO format: YYYY-MM-DDTHH:mm:00

## Port Name Normalization:
- Ashdod, Ahsdod, אשדוד → "Ashdod"
- Haifa, חיפה → "Haifa"
- Shipyards, מספנות → "Israel Shipyards"
- North Port, נמל הצפון → "North Port"
- South Port, נמל הדרום → "South Port"

## Status Mapping:
- Loading, בטעינה → LOADING
- Sailing, transit, en route, בדרך → EN_ROUTE
- Anchor, waiting, על עוגן → AT_ANCHOR
- Berthed, alongside, ברציף → BERTHED
- Working, discharging, עובדת → WORKING
- Sailed, departed, הפליגה → SAILED

Return ONLY valid JSON, no explanation.`;

            userPrompt = content;

            // Add context about existing ships if provided
            if (existingShips && existingShips.length > 0) {
                systemPrompt += `\n\n## Existing Ships in System (match if possible):\n${existingShips.join(', ')}`;
            }

        } else if (parseType === 'tally') {
            systemPrompt = `You are an expert at analyzing shipping tally reports, discharge reports, and cargo manifests.

CRITICAL: Extract ALL cargo types with their quantities and weights. Be thorough!

Return valid JSON only (no markdown, no explanation):

{
    "date": "YYYY-MM-DD",
    "vesselName": "string - vessel name",
    "voyage": "string or null - voyage number if found",
    "port": "string - port name",
    "operation": "DISCHARGE|LOADING|BOTH",

    "cargo": {
        "declared": [
            {
                "type": "string - cargo type (e.g., Steel Coils, Steel Rebars, Pipes)",
                "weightDeclared": 0,
                "weightUnit": "MT",
                "quantityDeclared": 0,
                "quantityUnit": "pcs|coils|bundles|etc",
                "blNumber": "string or null"
            }
        ],
        "discharged": [
            {
                "type": "string - cargo type",
                "weightDischarged": 0,
                "quantityDischarged": 0,
                "percentComplete": 0
            }
        ],
        "remaining": [
            {
                "type": "string - cargo type",
                "weightRemaining": 0,
                "quantityRemaining": 0
            }
        ],
        "totalDeclaredWeight": 0,
        "totalDeclaredQuantity": 0,
        "totalDischargedWeight": 0,
        "totalDischargedQuantity": 0,
        "totalRemainingWeight": 0,
        "totalRemainingQuantity": 0,
        "percentageComplete": 0
    },

    "shifts": [
        {
            "name": "Shift 1/2/3 or time period",
            "time": "time range if specified",
            "gangs": "gang numbers/cranes if specified",
            "cargoMoved": [
                {
                    "type": "cargo type",
                    "quantity": 0,
                    "weight": 0
                }
            ],
            "shiftTotalQuantity": 0,
            "shiftTotalWeight": 0
        }
    ],

    "dailyTotals": {
        "quantity": 0,
        "weight": 0
    },

    "cumulativeTotals": {
        "quantity": 0,
        "weight": 0
    },

    "remarks": ["array - all remarks, events, stoppages, delays, weather issues, damage notes"],
    "stoppages": [
        {
            "reason": "string - reason for stoppage",
            "duration": "string - duration if specified",
            "time": "string - time period if specified"
        }
    ],

    "extractionConfidence": 0.9
}

## Cargo Type Recognition:
- Steel Coils / Coils / HR Coils / CR Coils → "Steel Coils"
- Steel Rebars / Rebars / Deformed Bars → "Steel Rebars"
- Steel Sheets / Plates / HR Sheets → "Steel Sheets"
- Steel Pipes / Pipes / Tubes → "Steel Pipes"
- Billets / Steel Billets → "Steel Billets"
- If cargo type unknown, use exact text from document

## Weight Units:
- MT / mt / metric tons / tons → MT
- Always convert to MT if in other units

## Important Rules:
- Parse ALL cargo types separately - do not combine different types
- If document shows breakdown by cargo type, capture each type
- Weights in MT (metric tons) - convert kg to MT by dividing by 1000
- Extract ALL remarks and events
- If no shifts structure, create one "Total" entry
- Return ONLY valid JSON

## CRITICAL - Tally Report Summary Tables:
Many tally reports have summary tables with these key values - EXTRACT THEM:
- "Total Day" or "Today" = dailyTotals (today's discharge only)
- "Previous" = what was discharged before today (put in cumulativeTotals)
- "Manifest" = total declared cargo (put in cargo.totalDeclaredWeight/Quantity)
- "Grand Total" = total discharged so far including today
- "Remain" or "Balance" = remaining to discharge (put in cargo.remaining)

IMPORTANT: The "Remain" value from the report is the ACTUAL remaining, NOT calculated. Use it directly.

Example extraction from summary table:
| Total Day | 785 | 2,072,544 |
| Previous | 10,606 | 22,896,552 |
| Manifest | 18,603 | 47,001,817 |
| Remain | 7,212 | 22,032,720 |

Should produce:
- dailyTotals: { quantity: 785, weight: 2072.544 }
- cumulativeTotals: { quantity: 10606, weight: 22896.552 }
- cargo.totalDeclaredQuantity: 18603, cargo.totalDeclaredWeight: 47001.817
- cargo.remaining[0].weightRemaining: 22032.720, quantityRemaining: 7212`;

            userPrompt = `Analyze this tally/discharge report and extract ALL cargo information by type. Pay special attention to summary tables with Manifest, Previous, Remain values:\n\n${content}`;
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
            console.error('API error:', errorData);
            return res.status(response.status).json({
                error: 'API error',
                details: errorData
            });
        }

        const data = await response.json();

        // Extract the text content from Claude's response
        const textContent = data.content.find(c => c.type === 'text');
        if (!textContent) {
            return res.status(500).json({ error: 'No text response' });
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
