import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { PartRef, ResolvedPart } from "@almond-bot/harness-studio-core";

/**
 * Distributor API clients. Parts are always sourced from a real vendor:
 *   - LCSC: public product-detail endpoint, no API key required
 *   - Mouser: Search API key (https://www.mouser.com/api-hub/)
 *   - Digi-Key: Product Information v4 with OAuth2 client credentials
 *     (https://developer.digikey.com)
 */

export interface VendorConfig {
  mouser?: { apiKey?: string };
  digikey?: { clientId?: string; clientSecret?: string };
  lcsc?: Record<string, never>;
}

export const CONFIG_PATH = path.join(os.homedir(), ".config", "almond-harness-studio", "config.json");

export async function loadConfig(): Promise<VendorConfig> {
  let fileConfig: VendorConfig = {};
  try {
    fileConfig = JSON.parse(await fs.readFile(CONFIG_PATH, "utf8")) as VendorConfig;
  } catch {
    // No config file yet
  }
  return {
    ...fileConfig,
    mouser: { apiKey: process.env.MOUSER_API_KEY ?? fileConfig.mouser?.apiKey },
    digikey: {
      clientId: process.env.DIGIKEY_CLIENT_ID ?? fileConfig.digikey?.clientId,
      clientSecret: process.env.DIGIKEY_CLIENT_SECRET ?? fileConfig.digikey?.clientSecret,
    },
  };
}

export async function saveConfigValue(dottedKey: string, value: string): Promise<void> {
  const allowed = ["mouser.apiKey", "digikey.clientId", "digikey.clientSecret"];
  if (!allowed.includes(dottedKey)) {
    throw new Error(`unknown config key "${dottedKey}" (expected one of: ${allowed.join(", ")})`);
  }
  let config: Record<string, Record<string, string>> = {};
  try {
    config = JSON.parse(await fs.readFile(CONFIG_PATH, "utf8"));
  } catch {
    // start fresh
  }
  const [section, key] = dottedKey.split(".");
  config[section] = { ...config[section], [key]: value };
  await fs.mkdir(path.dirname(CONFIG_PATH), { recursive: true });
  await fs.writeFile(CONFIG_PATH, JSON.stringify(config, null, 2) + "\n", { mode: 0o600 });
}

const USER_AGENT = "almond-harness-studio/0.1 (+https://github.com/almond-bot/harness-studio)";

async function fetchJson(url: string, init?: RequestInit): Promise<unknown> {
  const res = await fetch(url, {
    ...init,
    headers: { "User-Agent": USER_AGENT, Accept: "application/json", ...init?.headers },
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} from ${new URL(url).host}`);
  return res.json();
}

/** Download a product photo and embed it as a data URI (skipped if oversized). */
async function fetchImageDataUri(url: string): Promise<string | undefined> {
  try {
    const res = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
    if (!res.ok) return undefined;
    const type = res.headers.get("content-type") ?? "image/jpeg";
    if (!type.startsWith("image/")) return undefined;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.byteLength > 400_000) return undefined;
    return `data:${type};base64,${buf.toString("base64")}`;
  } catch {
    return undefined;
  }
}

interface LcscDetail {
  code: number;
  result?: {
    productCode: string;
    productModel: string;
    productNameEn?: string;
    productIntroEn?: string;
    brandNameEn?: string;
    productImages?: string[];
    pdfUrl?: string;
    stockNumber?: number;
    productPriceList?: { ladder: number; usdPrice: number }[];
  };
}

async function resolveLcsc(ref: PartRef): Promise<ResolvedPart> {
  const data = (await fetchJson(
    `https://wmsc.lcsc.com/ftps/wm/product/detail?productCode=${encodeURIComponent(ref.number)}`,
    { headers: { "Accept-Language": "en-US,en" } }
  )) as LcscDetail;
  const p = data.result;
  if (data.code !== 200 || !p) throw new Error(`LCSC part ${ref.number} not found`);

  // LCSC serves resized variants by path (900x900 -> 224x224)
  const rawImage = p.productImages?.[0];
  const imageUrl = rawImage?.replace("/900x900/", "/224x224/") ?? rawImage;
  return {
    vendor: "lcsc",
    number: p.productCode,
    mpn: p.productModel,
    manufacturer: p.brandNameEn ?? "",
    description: p.productNameEn ?? p.productIntroEn ?? "",
    datasheetUrl: p.pdfUrl,
    imageUrl: rawImage,
    image: imageUrl ? await fetchImageDataUri(imageUrl) : undefined,
    productUrl: `https://www.lcsc.com/product-detail/${p.productCode}.html`,
    priceUsd: p.productPriceList?.[0]?.usdPrice,
    stock: p.stockNumber,
    fetchedAt: new Date().toISOString(),
  };
}

interface MouserSearchResponse {
  Errors?: { Message?: string }[];
  SearchResults?: {
    Parts?: {
      MouserPartNumber?: string;
      ManufacturerPartNumber?: string;
      Manufacturer?: string;
      Description?: string;
      DataSheetUrl?: string;
      ImagePath?: string;
      ProductDetailUrl?: string;
      AvailabilityInStock?: string;
      PriceBreaks?: { Quantity: number; Price: string }[];
    }[];
  };
}

async function resolveMouser(ref: PartRef, config: VendorConfig): Promise<ResolvedPart> {
  const apiKey = config.mouser?.apiKey;
  if (!apiKey) {
    throw new Error(
      "Mouser API key not configured — run `config set mouser.apiKey <key>` or set MOUSER_API_KEY"
    );
  }
  const data = (await fetchJson(
    `https://api.mouser.com/api/v1/search/partnumber?apiKey=${encodeURIComponent(apiKey)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        SearchByPartRequest: { mouserPartNumber: ref.number, partSearchOptions: "Exact" },
      }),
    }
  )) as MouserSearchResponse;
  const apiError = data.Errors?.[0]?.Message;
  if (apiError) throw new Error(`Mouser: ${apiError}`);
  const p = data.SearchResults?.Parts?.[0];
  if (!p) throw new Error(`Mouser part ${ref.number} not found`);

  const price = p.PriceBreaks?.[0]?.Price?.replace(/[^0-9.]/g, "");
  return {
    vendor: "mouser",
    number: p.MouserPartNumber ?? ref.number,
    mpn: p.ManufacturerPartNumber ?? ref.number,
    manufacturer: p.Manufacturer ?? "",
    description: p.Description ?? "",
    datasheetUrl: p.DataSheetUrl || undefined,
    imageUrl: p.ImagePath || undefined,
    image: p.ImagePath ? await fetchImageDataUri(p.ImagePath) : undefined,
    productUrl: p.ProductDetailUrl || undefined,
    priceUsd: price ? Number(price) : undefined,
    stock: p.AvailabilityInStock ? Number(p.AvailabilityInStock) : undefined,
    fetchedAt: new Date().toISOString(),
  };
}

let digikeyToken: { token: string; expiresAt: number } | null = null;

async function digikeyAccessToken(config: VendorConfig): Promise<string> {
  const { clientId, clientSecret } = config.digikey ?? {};
  if (!clientId || !clientSecret) {
    throw new Error(
      "Digi-Key credentials not configured — run `config set digikey.clientId <id>` and " +
        "`config set digikey.clientSecret <secret>`, or set DIGIKEY_CLIENT_ID / DIGIKEY_CLIENT_SECRET"
    );
  }
  if (digikeyToken && Date.now() < digikeyToken.expiresAt - 60_000) return digikeyToken.token;
  const data = (await fetchJson("https://api.digikey.com/v1/oauth2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "client_credentials",
    }).toString(),
  })) as { access_token: string; expires_in: number };
  digikeyToken = { token: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 };
  return data.access_token;
}

interface DigikeyProduct {
  Product?: {
    ManufacturerProductNumber?: string;
    Manufacturer?: { Name?: string };
    Description?: { ProductDescription?: string; DetailedDescription?: string };
    DatasheetUrl?: string;
    PhotoUrl?: string;
    ProductUrl?: string;
    QuantityAvailable?: number;
    UnitPrice?: number;
    ProductVariations?: { DigiKeyProductNumber?: string }[];
  };
}

async function resolveDigikey(ref: PartRef, config: VendorConfig): Promise<ResolvedPart> {
  const token = await digikeyAccessToken(config);
  const data = (await fetchJson(
    `https://api.digikey.com/products/v4/search/${encodeURIComponent(ref.number)}/productdetails`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        "X-DIGIKEY-Client-Id": config.digikey!.clientId!,
        "X-DIGIKEY-Locale-Site": "US",
        "X-DIGIKEY-Locale-Language": "en",
        "X-DIGIKEY-Locale-Currency": "USD",
      },
    }
  )) as DigikeyProduct;
  const p = data.Product;
  if (!p) throw new Error(`Digi-Key part ${ref.number} not found`);

  return {
    vendor: "digikey",
    number: p.ProductVariations?.[0]?.DigiKeyProductNumber ?? ref.number,
    mpn: p.ManufacturerProductNumber ?? ref.number,
    manufacturer: p.Manufacturer?.Name ?? "",
    description: p.Description?.ProductDescription ?? "",
    datasheetUrl: p.DatasheetUrl || undefined,
    imageUrl: p.PhotoUrl || undefined,
    image: p.PhotoUrl ? await fetchImageDataUri(p.PhotoUrl) : undefined,
    productUrl: p.ProductUrl || undefined,
    priceUsd: p.UnitPrice,
    stock: p.QuantityAvailable,
    fetchedAt: new Date().toISOString(),
  };
}

export async function resolvePart(ref: PartRef, config: VendorConfig): Promise<ResolvedPart> {
  switch (ref.vendor) {
    case "lcsc":
      return resolveLcsc(ref);
    case "mouser":
      return resolveMouser(ref, config);
    case "digikey":
      return resolveDigikey(ref, config);
  }
}
