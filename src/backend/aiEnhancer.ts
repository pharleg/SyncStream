/**
 * aiEnhancer.ts
 *
 * AI-powered product description enhancement using Claude API.
 * Generates SEO/AEO-optimized descriptions, caches results
 * in Supabase enhanced_content table with source hash invalidation.
 */

import Anthropic from '@anthropic-ai/sdk';
import { secrets } from '@wix/secrets';
import type { WixProduct } from '../types/wix.types';
import type { EnhancedContent } from '../types/rules.types';
import {
  getEnhancedContent,
  getBulkEnhancedContent,
  saveEnhancedContent,
} from './dataService';

let _anthropicClient: Anthropic | null = null;

async function getAnthropicClient(): Promise<Anthropic> {
  if (_anthropicClient) return _anthropicClient;
  const apiKey = (await secrets.getSecretValue('anthropic_api_key')).value!;
  _anthropicClient = new Anthropic({ apiKey });
  return _anthropicClient;
}

/** Generate a SHA-256 hash of the product's source content for cache invalidation. */
export async function getSourceHash(product: WixProduct): Promise<string> {
  const content = [
    product.name ?? '',
    product.plainDescription ?? product.description ?? '',
    product.brand?.name ?? '',
  ].join('|');

  const encoder = new TextEncoder();
  const data = encoder.encode(content);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Build the prompt for Claude to enhance a product description. */
function buildEnhancementPrompt(product: WixProduct, style?: string): string {
  const title = product.name ?? '';
  const description = product.plainDescription ?? product.description ?? '';
  const brand = product.brand?.name ?? '';
  const price = product.actualPriceRange?.minValue?.amount
    ?? product.priceData?.price
    ?? product.price?.price
    ?? '';

  return `You are a product content specialist. Enhance this product listing for Google Shopping and Meta Catalog feeds.

PRODUCT DATA:
- Title: ${title}
- Current Description: ${description || '(no description provided)'}
- Brand: ${brand || '(not specified)'}
- Price: ${price}

INSTRUCTIONS:
1. Write an SEO-optimized product description (150-300 words)
2. Include relevant keywords naturally — do NOT keyword-stuff
3. If the current description is thin or empty, generate a complete description from the title and available attributes
4. Structure for answer-engine optimization: lead with a clear product summary sentence, then key features, then use cases
5. Strip any promotional language ("Buy now!", "Free shipping!", "Add to cart")
6. Do NOT use all-caps (Meta rejects this)
7. Do NOT include pricing in the description
8. Write in third person
${style ? `9. Style/tone: ${style}` : ''}

Respond with ONLY a JSON object:
{"title": "optimized title (under 150 chars)", "description": "optimized description"}`;
}

/** Enhance a single product's content via Claude API. */
async function generateEnhancement(
  product: WixProduct,
  style?: string,
): Promise<{ title: string; description: string }> {
  const client = await getAnthropicClient();
  const prompt = buildEnhancementPrompt(product, style);

  const response = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 1024,
    messages: [{ role: 'user', content: prompt }],
  });

  const text = response.content[0].type === 'text' ? response.content[0].text : '';

  try {
    const parsed = JSON.parse(text);
    return {
      title: parsed.title ?? product.name,
      description: parsed.description ?? '',
    };
  } catch {
    return {
      title: product.name,
      description: text.trim(),
    };
  }
}

/**
 * Enhance a single product. Uses cached content if source hash matches,
 * otherwise generates new content via Claude API.
 */
export async function enhanceProduct(
  product: WixProduct,
  instanceId: string,
  style?: string,
): Promise<{ title: string; description: string }> {
  const productId = product._id ?? product.id;
  const sourceHash = await getSourceHash(product);

  const cached = await getEnhancedContent(instanceId, productId);
  if (cached && cached.sourceHash === sourceHash) {
    return {
      title: cached.enhancedTitle ?? product.name,
      description: cached.enhancedDescription,
    };
  }

  const enhanced = await generateEnhancement(product, style);

  await saveEnhancedContent({
    instanceId,
    productId,
    platform: 'both',
    enhancedTitle: enhanced.title,
    enhancedDescription: enhanced.description,
    sourceHash,
    generatedAt: new Date().toISOString(),
  });

  return enhanced;
}

/**
 * Enhance multiple products. Fetches cached content in bulk,
 * only calls Claude API for products with stale or missing cache.
 */
export async function enhanceProducts(
  products: WixProduct[],
  instanceId: string,
  style?: string,
): Promise<Map<string, { title: string; description: string }>> {
  const productIds = products.map((p) => p._id ?? p.id);
  const cachedMap = await getBulkEnhancedContent(instanceId, productIds);
  const results = new Map<string, { title: string; description: string }>();

  for (const product of products) {
    const productId = product._id ?? product.id;
    const sourceHash = await getSourceHash(product);
    const cached = cachedMap.get(productId);

    if (cached && cached.sourceHash === sourceHash) {
      results.set(productId, {
        title: cached.enhancedTitle ?? product.name,
        description: cached.enhancedDescription,
      });
      continue;
    }

    const enhanced = await generateEnhancement(product, style);

    await saveEnhancedContent({
      instanceId,
      productId,
      platform: 'both',
      enhancedTitle: enhanced.title,
      enhancedDescription: enhanced.description,
      sourceHash,
      generatedAt: new Date().toISOString(),
    });

    results.set(productId, enhanced);
  }

  return results;
}
