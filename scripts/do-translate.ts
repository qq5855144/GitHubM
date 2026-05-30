import * as fs from "fs";

const apiKey = process.env["INTEGRATIONS_API_KEY"]!;

async function translateText(q: string, from: string, to: string) {
  const response = await fetch(
    "https://app-bo4w33bsdqm9-api-e94GZ5j0PWpa-gateway.appmiaoda.com/rpc/2.0/mt/texttrans/v1",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json;charset=utf-8",
        "X-Gateway-Authorization": `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ q, from, to }),
    },
  );

  if (!response.ok) {
    console.error(await response.text());
    throw new Error(`HTTP error: ${response.status}`);
  }

  const json = await response.json();
  if (json.error_code) {
    throw new Error(`API error ${json.error_code}: ${json.error_msg}`);
  }

  return json.result;
}

async function main() {
  const extracted = JSON.parse(fs.readFileSync("/workspace/app-bo4w33bsdqm9/extracted-zh.json", "utf-8"));
  const keys = Object.keys(extracted);
  
  let translatedDict: Record<string, string> = {};
  if (fs.existsSync("/workspace/app-bo4w33bsdqm9/translated-en.json")) {
    translatedDict = JSON.parse(fs.readFileSync("/workspace/app-bo4w33bsdqm9/translated-en.json", "utf-8"));
  }

  // Find missing keys
  const missingKeys = keys.filter(k => !translatedDict[k] || translatedDict[k] === k);
  console.log(`Missing translations for ${missingKeys.length} keys out of ${keys.length}`);

  // Batch translate
  const chunkSize = 20; // 20 strings per batch using \n separator
  for (let i = 0; i < missingKeys.length; i += chunkSize) {
    const batch = missingKeys.slice(i, i + chunkSize);
    const textToTranslate = batch.join("\n");
    console.log(`Translating batch ${i/chunkSize + 1}/${Math.ceil(missingKeys.length/chunkSize)}...`);
    
    try {
      const result = await translateText(textToTranslate, "zh", "en");
      // The API returns array of segments
      if (result && result.trans_result) {
        for (let j = 0; j < batch.length; j++) {
          if (j < result.trans_result.length) {
            translatedDict[batch[j]] = result.trans_result[j].dst;
          } else {
            translatedDict[batch[j]] = batch[j];
          }
        }
      }
      fs.writeFileSync("/workspace/app-bo4w33bsdqm9/translated-en.json", JSON.stringify(translatedDict, null, 2));
      // wait 100ms
      await new Promise(r => setTimeout(r, 100));
    } catch (e) {
      console.error("Error in batch:", e);
      break;
    }
  }

  console.log("Translation done.");
}

main().catch(console.error);
