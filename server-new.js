require("dotenv").config();
const express = require("express");
const multer = require("multer");
const fs = require("fs");
const cors = require("cors");
const axios = require("axios");
const { createCanvas } = require("canvas");

const app = express();
const upload = multer({ dest: "uploads/" });

app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

async function convertPdfToBase64Image(pdfPath) {
  const pdfjsLib = await import("pdfjs-dist/legacy/build/pdf.js").then(
    (m) => m.default
  );
  const { createCanvas } = require("canvas");

  const data = new Uint8Array(fs.readFileSync(pdfPath));
  const pdf = await pdfjsLib.getDocument({ data }).promise;
  const page = await pdf.getPage(1);

  const viewport = page.getViewport({ scale: 2 });
  const canvas = createCanvas(viewport.width, viewport.height);
  const context = canvas.getContext("2d");

  const renderContext = {
    canvasContext: context,
    viewport: viewport,
  };

  await page.render(renderContext).promise;
  const buffer = canvas.toBuffer("image/png");
  return buffer.toString("base64");
}

app.post("/upload-file", upload.array("files"), async (req, res) => {
  try {
    const imageContents = [];

    for (const file of req.files) {
      const filePath = file.path;
      let mimeType = file.mimetype;
      let base64Image = "";

      if (mimeType === "application/pdf") {
        base64Image = await convertPdfToBase64Image(filePath);
        mimeType = "image/png";
      } else if (mimeType.startsWith("image/")) {
        const imageBuffer = fs.readFileSync(filePath);
        base64Image = imageBuffer.toString("base64");
      } else {
        fs.unlinkSync(filePath);
        continue;
      }

      imageContents.push({
        type: "image_url",
        image_url: {
          url: `data:${mimeType};base64,${base64Image}`,
        },
      });

      fs.unlinkSync(filePath);
    }

    if (imageContents.length === 0) {
      return res
        .status(400)
        .json({ error: "No valid PDF or image files found." });
    }

    const prompt = `
      Kijk naar de menukaart en de wijnkaart. Geef bij elk item van de menukaart 2 bijpassende wijnen van de wijnkaart.
      Gebruik dit exacte formaat:
      Naam gerecht: "gerechtnaam"
      Naam wijn: "naam", Beschrijving: "beschrijving"
      Naam wijn: "naam", Beschrijving: "beschrijving"
      Gebruik ongeveer 40 woorden per beschrijving.
    `;

    const completion = await axios.post(
      "https://api.openai.com/v1/chat/completions",
      {
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: "Je bent een sommelier." },
          {
            role: "user",
            content: [{ type: "text", text: prompt }, ...imageContents],
          },
        ],
      },
      {
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        },
      }
    );

    const fullText = completion.data.choices[0].message.content;

    function parseWijnSpijsTekst(text) {
      const items = text.split(/(?=Naam gerecht:)/g);
      const results = [];

      items.forEach((item) => {
        const gerechtMatch = item.match(/Naam gerecht:\s*"([^"]+)"/);
        const wijnMatches = [
          ...item.matchAll(
            /Naam wijn:\s*"([^"]+)",\s*Beschrijving:\s*"([^"]+)"/g
          ),
        ];

        if (gerechtMatch && wijnMatches.length === 2) {
          results.push({
            gerecht: gerechtMatch[1],
            wijnen: wijnMatches.map((match) => ({
              naam: match[1],
              beschrijving: match[2],
            })),
          });
        }
      });

      return results;
    }

    const parsed = parseWijnSpijsTekst(fullText);
    console.log("✅ Analyse succesvol:", parsed);
    
    res.json({ result: parsed });
  } catch (err) {
    console.error("❌ Analyse mislukt:", err.message);
    res.status(500).json({ error: "Analyse mislukt" });
  }
});

app.listen(3000, () => {
  console.log("Server is running on http://localhost:3000");
});
