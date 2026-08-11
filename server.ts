import express from "express";
import path from "path";
import fs from "fs";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI } from "@google/genai";

const PORT = 3000;

// Hardcoded interesting locations across the globe
const LOCATIONS = [
  "Eiffel Tower, Paris",
  "Taj Mahal, India",
  "Statue of Liberty, New York",
  "Great Wall of China",
  "Machu Picchu, Peru",
  "Colosseum, Rome",
  "Pyramids of Giza, Egypt",
  "Sydney Opera House",
  "Mount Fuji, Japan",
  "Santorini, Greece",
  "Stonehenge, UK",
  "Petra, Jordan",
  "Burj Khalifa, Dubai",
  "Niagara Falls, Canada",
  "Mount Everest, Himalayas",
  "Golden Gate Bridge, San Francisco",
  "Acropolis of Athens",
  "Angkor Wat, Cambodia",
  "Sagrada Familia, Barcelona",
  "Venice Canals, Italy",
  "Victoria Falls, Zambia",
  "Galapagos Islands",
  "Easter Island statues",
  "Chichen Itza, Mexico",
  "Yellowstone Grand Prismatic Spring",
  "Aurora Borealis in Iceland",
  "Serengeti National Park, Tanzania",
  "Banff National Park, Canada",
  "Salar de Uyuni, Bolivia",
  "Bora Bora overwater bungalows",
  "Maldives beaches",
  "Christ the Redeemer, Brazil",
  "Table Mountain, South Africa",
  "Neuschwanstein Castle, Germany",
  "St. Basil's Cathedral, Moscow",
  "Forbidden City, Beijing",
  "Halong Bay, Vietnam",
  "Times Square, New York at night",
  "Grand Canyon, Arizona",
  "Big Ben, London",
  "Louvre Museum pyramid, Paris",
  "Blue Lagoon, Iceland",
  "Mount Kilimanjaro",
  "Cinque Terre, Italy",
  "Lake Como, Italy",
  "The Alhambra, Spain",
  "Cappadocia hot air balloons, Turkey",
  "Antelope Canyon, Arizona"
];

const PHOTO_IDS = [
  10, 11, 12, 13, 14, 15, 16, 17, 28, 29, 37, 39, 43, 49, 50, 
  54, 57, 58, 59, 61, 62, 63, 64, 65, 68, 69, 71, 74, 82, 87, 
  91, 111, 112, 113, 114, 115, 119, 122, 129, 133, 134, 136, 139, 142, 146, 
  152, 153, 154, 158, 161, 163, 164, 169, 175, 177, 180, 185, 188, 191, 196
];

// Load pre-generated location details archive
let locationArchive: Record<string, string> = {};
try {
  const jsonPath = path.join(process.cwd(), 'src', 'locationInfo.json');
  if (fs.existsSync(jsonPath)) {
    locationArchive = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
  }
} catch (e) {
  console.log("Archive location dataset not present or unreadable");
}

const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY || "",
  httpOptions: {
    headers: {
      'User-Agent': 'aistudio-build',
    }
  }
});

async function startServer() {
  const app = express();
  
  app.use(express.json({ limit: '50mb' }));

  // API endpoint
  app.post("/api/generate-location", async (req, res) => {
    try {
      const { index, userImageBase64 } = req.body;
      const location = LOCATIONS[index % LOCATIONS.length];
      
      let finalBase64 = "";
      let info = "";

      if (process.env.GEMINI_API_KEY) {
        try {
          const promptText = `A bright, vivid, photorealistic travel photo taken directly in front of the ${location}. Extremely detailed background. High quality, stunning. Keep the exact same subjects from the original image—preserving the exact number of people, their faces, body structures, and poses. Only change their outfits to be culturally or weather appropriate for the location, and seamlessly place them in this new environment.`;
          let parts: any[] = [{ text: promptText }];
          
          if (userImageBase64) {
            const match = userImageBase64.match(/^data:(image\/[a-zA-Z]*);base64,([^"]*)$/);
            if (match && match.length === 3) {
              parts.unshift({
                inlineData: {
                  mimeType: match[1],
                  data: match[2],
                },
              });
            }
          }

          const imagePromise = ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: { parts },
          }).catch((err: any) => {
            const errStr = err?.message || String(err);
            if (errStr.includes('429') || errStr.includes('RESOURCE_EXHAUSTED')) {
              console.log(`[Notice] Gemini quota reached for location #${index}. Using photography archive.`);
            }
            return null;
          });

          const infoPromise = ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: `Provide information about ${location} exactly in this format:
# [Name of Location], [Name of Country] [Country Flag Emoji]
[One short, engaging paragraph about the location as a travel destination]
Do not include any other text or introductory phrases.`,
          }).catch(() => null);

          const [imageResponse, infoResponse] = await Promise.all([imagePromise, infoPromise]);
          
          if (imageResponse) {
            for (const part of imageResponse.candidates?.[0]?.content?.parts || []) {
              if (part.inlineData) {
                finalBase64 = `data:${part.inlineData.mimeType || 'image/png'};base64,${part.inlineData.data}`;
                break;
              }
            }
          }

          if (infoResponse && infoResponse.text) {
            info = infoResponse.text;
          }

        } catch (e: any) {
          // Graceful fallback
        }
      }

      // High quality fallback photo if AI generation wasn't available or quota reached
      if (!finalBase64) {
        const photoId = PHOTO_IDS[index % PHOTO_IDS.length];
        finalBase64 = `https://picsum.photos/id/${photoId}/600/800`;
      }

      if (!info) {
        const fullDesc = locationArchive[location];
        if (fullDesc) {
          info = `# ${location}\n\n${fullDesc}`;
        } else {
          info = `# ${location}\n\nA magnificent landmark and premier travel destination known for its iconic architecture and deep cultural history.`;
        }
      }

      res.json({ success: true, base64: finalBase64, location, info });
    } catch (e) {
      console.error("Error generating location card:", e);
      res.status(500).json({ success: false });
    }
  });

  // API endpoint for generating location description
  app.post("/api/location-info", async (req, res) => {
    try {
      const { location } = req.body;
      if (!process.env.GEMINI_API_KEY) {
        return res.json({ info: "Information about " + location + " is not available because the Gemini API key is missing." });
      }
      const response = await ai.models.generateContent({
        model: 'gemini-3.1-flash-lite',
        contents: `Provide information about ${location} exactly in this format:
# [Name of Location], [Name of Country] [Country Flag Emoji]
[One short, engaging paragraph about the location as a travel destination]
Do not include any other text or introductory phrases.`,
      });
      res.json({ info: response.text });
    } catch (e) {
      console.error(e);
      res.status(500).json({ info: "Could not load information at this time." });
    }
  });

  // Endpoint to start omni generation
  app.post('/api/generate-video', async (req, res) => {
    try {
      const { imageBase64, prompt } = req.body;

      if (!process.env.GEMINI_API_KEY) {
        return res.status(400).json({ success: false, error: "Missing API Key" });
      }

      const match = imageBase64.match(/^data:(image\/[a-zA-Z]*);base64,([^"]*)$/);
      if (!match || match.length !== 3) {
        return res.status(400).json({ success: false, error: "Invalid base64 image" });
      }

      console.log(`Sending request to Gemini Omni...`);

      const interaction = await ai.interactions.create({
        model: 'gemini-omni-flash-preview',
        input: [
            { type: 'image' as const, data: match[2], mime_type: match[1] },
            { type: 'text', text: prompt || 'A beautiful cinematic panning video' }
        ],
        response_format: { type: 'video', delivery: 'uri' },
        store: true,
        background: false,
        stream: false
      });

      console.log(`Interaction created: ${interaction.id}`);
      
      if (!interaction.output_video || !interaction.output_video.uri) {
        throw new Error('No video URI returned from interaction.');
      }
      
      const fileIdMatch = interaction.output_video.uri.match(/files\/([a-zA-Z0-9_-]+)/);
      const fileId = fileIdMatch ? fileIdMatch[1] : null;

      res.json({ success: true, interactionId: interaction.id, uri: interaction.output_video.uri, fileId });
    } catch (e: any) {
      console.error('Error generating video:', e);
      res.status(500).json({ success: false, error: e?.body || e.message });
    }
  });

  // Endpoint to poll file status
  app.post('/api/video-status', async (req, res) => {
    try {
      const { fileId } = req.body;
      if (!fileId) return res.status(400).json({ error: "fileId is required" });
      
      const fInfo = await ai.files.get({ name: `files/${fileId}` });
      const state = (fInfo.state as any)?.name || fInfo.state;
      // Map state to the expected 'done' boolean for the frontend
      const done = state === 'ACTIVE' || state === 'FAILED' || state === 'STATE_UNSPECIFIED' ? state === 'ACTIVE' : (state === 'SUCCEEDED' || state === 'FAILED');
      
      // Usually, if it's available for download it's ACTIVE, but we'll return the raw state too
      res.json({ done: state === 'ACTIVE' || state === 'SUCCEEDED', state });
    } catch(e: any) {
      console.error("Video polling error:", e);
      res.status(500).json({ success: false, error: e.message });
    }
  });

  const videoCache = new Map<string, Buffer>();

  app.get('/api/video-download', async (req, res) => {
    try {
      const fileId = req.query.fileId as string;
      if (!fileId) {
        return res.status(400).json({ error: "fileId is required" });
      }

      let buffer = videoCache.get(fileId);
      if (!buffer) {
        const apiKey = process.env.GEMINI_API_KEY;
        const url = `https://generativelanguage.googleapis.com/v1beta/files/${fileId}:download?alt=media&key=${apiKey}`;
        const upstream = await fetch(url);
        if (!upstream.ok) {
          return res.status(upstream.status).send(`Failed to fetch video: ${upstream.statusText}`);
        }
        buffer = Buffer.from(await upstream.arrayBuffer());
        if (videoCache.size >= 12) {
          const oldest = videoCache.keys().next().value;
          if (oldest) videoCache.delete(oldest);
        }
        videoCache.set(fileId, buffer);
      }

      const total = buffer.length;
      res.setHeader('Content-Type', 'video/mp4');
      res.setHeader('Accept-Ranges', 'bytes');
      res.setHeader('Cache-Control', 'public, max-age=31536000');

      const range = req.headers.range;
      if (range) {
        const match = /bytes=(\d*)-(\d*)/.exec(range);
        let start = match && match[1] ? parseInt(match[1], 10) : 0;
        let end = match && match[2] ? parseInt(match[2], 10) : total - 1;
        if (Number.isNaN(start)) start = 0;
        if (Number.isNaN(end) || end >= total) end = total - 1;
        if (start > end || start >= total) {
          res.status(416).setHeader('Content-Range', `bytes */${total}`).end();
          return;
        }
        res.status(206);
        res.setHeader('Content-Range', `bytes ${start}-${end}/${total}`);
        res.setHeader('Content-Length', end - start + 1);
        res.end(buffer.subarray(start, end + 1));
      } else {
        res.setHeader('Content-Length', total);
        res.end(buffer);
      }
    } catch(e: any) {
      console.error("Video download error:", e);
      res.status(500).json({ success: false, error: e.message });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
