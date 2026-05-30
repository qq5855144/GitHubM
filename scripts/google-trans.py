import urllib.request
import urllib.parse
import json
import time

def translate_text(text, target_lang="en"):
    url = "https://translate.googleapis.com/translate_a/single"
    params = {
        "client": "gtx",
        "sl": "zh-CN",
        "tl": target_lang,
        "dt": "t",
        "q": text
    }
    query_string = urllib.parse.urlencode(params)
    full_url = f"{url}?{query_string}"
    
    req = urllib.request.Request(
        full_url, 
        headers={"User-Agent": "Mozilla/5.0"}
    )
    
    try:
        with urllib.request.urlopen(req) as response:
            res_body = response.read().decode('utf-8')
            data = json.loads(res_body)
            # data[0] contains the translation segments
            return "".join([segment[0] for segment in data[0]])
    except Exception as e:
        print(f"Error translating {text}: {e}")
        return text

if __name__ == "__main__":
    with open("/workspace/app-bo4w33bsdqm9/extracted-zh.json", "r", encoding="utf-8") as f:
        extracted = json.load(f)
    
    keys = list(extracted.keys())
    translated_dict = {}
    
    # Try loading existing
    try:
        with open("/workspace/app-bo4w33bsdqm9/translated-en.json", "r", encoding="utf-8") as f:
            translated_dict = json.load(f)
    except:
        pass
    
    # Batch it up to speed up? google-translate-api might rate limit.
    # Let's do it in chunks.
    chunk = []
    chunk_size = 50
    for i in range(0, len(keys), chunk_size):
        batch_keys = keys[i:i+chunk_size]
        batch_text = " \\n ".join(batch_keys)
        
        # Check if all keys already translated
        if all(k in translated_dict for k in batch_keys):
            continue
            
        print(f"Translating {i} to {i+chunk_size}...")
        en_text = translate_text(batch_text)
        
        en_lines = en_text.split(" \\n ")
        for j, k in enumerate(batch_keys):
            if j < len(en_lines):
                translated_dict[k] = en_lines[j].strip()
            else:
                translated_dict[k] = k
                
        time.sleep(1) # avoid rate limit
        
        with open("/workspace/app-bo4w33bsdqm9/translated-en.json", "w", encoding="utf-8") as f:
            json.dump(translated_dict, f, ensure_ascii=False, indent=2)

    print("Translation done.")
