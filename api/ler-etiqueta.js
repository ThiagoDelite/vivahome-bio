// Vercel Function: lê a foto de uma etiqueta e devolve os campos em JSON.
// Variáveis de ambiente (Vercel > Settings > Environment Variables):
//   GEMINI_API_KEY     chave do Google Gemini (aistudio.google.com)  ← usada se existir
//   ANTHROPIC_API_KEY  alternativa: chave da Anthropic (console.anthropic.com)
//   SUPABASE_URL       URL do projeto Supabase
//   SUPABASE_ANON_KEY  chave pública (anon) do Supabase
//   GEMINI_MODEL / ANTHROPIC_MODEL  opcionais, para trocar o modelo
// Só responde para quem está logado na área interna (token do Supabase).

const PROMPT =
  "A imagem é a foto de uma etiqueta de produto de uma loja de móveis e decoração (Vivá Home, Brasil). " +
  "Leia a etiqueta e responda SOMENTE com um objeto JSON com as chaves: " +
  '"nome" (nome do produto como escrito), "codigo" (código, referência ou SKU), "marca" (marca ou fornecedor), ' +
  '"medidas" (dimensões, se houver), "preco" (preço como escrito, se houver), ' +
  '"tipo" (o que é o produto em uma ou duas palavras em português, ex.: Vaso, Escultura, Sofá), ' +
  '"grupo" ("Decor" para objetos decorativos, têxteis, quadros e iluminação de mesa; "Mobiliário" para móveis), ' +
  '"detalhes" (material, cor, acabamento), "texto" (todo o texto legível da etiqueta, linha por linha). ' +
  'Use string vazia para o que não aparecer. Não invente informação que não está na etiqueta, exceto em "tipo" e "grupo".';

module.exports = async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ erro: "Use POST." });
  const { GEMINI_API_KEY, ANTHROPIC_API_KEY, SUPABASE_URL, SUPABASE_ANON_KEY } = process.env;
  if (!(GEMINI_API_KEY || ANTHROPIC_API_KEY) || !SUPABASE_URL || !SUPABASE_ANON_KEY)
    return res.status(503).json({ erro: "Leitura automática não configurada." });

  const token = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (!token) return res.status(401).json({ erro: "Faça login." });
  const quem = await fetch(SUPABASE_URL + "/auth/v1/user", { headers: { apikey: SUPABASE_ANON_KEY, Authorization: "Bearer " + token } });
  if (!quem.ok) return res.status(401).json({ erro: "Sessão expirada. Entre de novo." });
  const { imagem, tipo } = req.body || {};
  if (!imagem || typeof imagem !== "string" || imagem.length > 6_000_000)
    return res.status(400).json({ erro: "Imagem ausente ou grande demais." });
  try {
    let texto = "";
    if (GEMINI_API_KEY) {
      const modelo = process.env.GEMINI_MODEL || "gemini-2.5-flash";
      const r = await fetch("https://generativelanguage.googleapis.com/v1beta/models/" + modelo + ":generateContent", {
        method: "POST",
        headers: { "content-type": "application/json", "x-goog-api-key": GEMINI_API_KEY },
        body: JSON.stringify({ contents: [{ role: "user", parts: [{ inline_data: { mime_type: tipo || "image/jpeg", data: imagem } }, { text: PROMPT }] }], generationConfig: { responseMimeType: "application/json", temperature: 0 } })
      });
      const j = await r.json();
      if (!r.ok) return res.status(502).json({ erro: "A leitura falhou.", detalhe: j?.error?.message || r.status });
      texto = (j.candidates?.[0]?.content?.parts || []).map(p => p.text || "").join("");
    } else {
      const r = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "content-type": "application/json", "x-api-key": ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
        body: JSON.stringify({ model: process.env.ANTHROPIC_MODEL || "claude-sonnet-4-5", max_tokens: 1024, messages: [{ role: "user", content: [ { type: "image", source: { type: "base64", media_type: tipo || "image/jpeg", data: imagem } }, { type: "text", text: PROMPT } ] }] })
      });
      const j = await r.json();
      if (!r.ok) return res.status(502).json({ erro: "A leitura falhou.", detalhe: j?.error?.message || r.status });
      texto = (j.content || []).filter(c => c.type === "text").map(c => c.text).join("");
    }
    const m = texto.match(/\{[\s\S]*\}/);
    if (!m) return res.status(502).json({ erro: "Não consegui interpretar a etiqueta." });
    return res.status(200).json(JSON.parse(m[0]));
  } catch (e) {
    return res.status(502).json({ erro: "A leitura falhou." });
  }
};
