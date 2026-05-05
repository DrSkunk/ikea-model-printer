import type { IkeaModelInfo, IkeaSearchProduct } from '$lib/types/ikea';

const CLIENT_ID = '4863e7d2-1428-4324-890b-ae5dede24fc6';
const USER_AGENT = 'ikea-model-printer (https://github.com/DrSkunk/sh3d-ikea-models inspired)';
const TIMEOUT_MS = 15000;

function compactItemNo(itemNo: string): string {
	return itemNo.replace(/\D/g, '');
}

function toFiniteNumber(value: unknown): number | null {
	if (typeof value === 'number' && Number.isFinite(value)) return value;
	if (typeof value === 'string') {
		const parsed = Number(value);
		return Number.isFinite(parsed) ? parsed : null;
	}
	return null;
}

function pickMeasurement(measurements: unknown, type: 'width' | 'depth' | 'height'): number | null {
	if (!Array.isArray(measurements)) return null;
	for (const measurement of measurements) {
		if (!measurement || typeof measurement !== 'object') continue;
		const asRecord = measurement as Record<string, unknown>;
		if (asRecord.measurementType !== type) continue;
		const value = toFiniteNumber(asRecord.value);
		if (value && value > 0) return value;
	}
	return null;
}

function buildSearchParams(query: string): URLSearchParams {
	const params = new URLSearchParams({
		types: 'PRODUCT',
		q: query,
		c: 'sr',
		v: '20210322'
	});

	if (/^\d[\d\s.-]*$/.test(query.trim())) {
		params.set('size', '1');
	} else {
		params.set('size', '24');
		params.set('autocorrect', 'true');
		params.set('subcategories-style', 'tree-navigation');
	}

	return params;
}

async function fetchIkeaJson(
	url: string,
	withClientId: boolean,
	signal?: AbortSignal
): Promise<Record<string, unknown>> {
	const headers: HeadersInit = {
		Accept: '*/*',
		'User-Agent': USER_AGENT
	};
	if (withClientId) {
		headers['X-Client-Id'] = CLIENT_ID;
	}

	const response = await fetch(url, { headers, signal });
	if (!response.ok) {
		throw new Error(`IKEA API request failed (${response.status}) for ${url}`);
	}

	const data = (await response.json()) as unknown;
	if (!data || typeof data !== 'object') {
		throw new Error(`Unexpected JSON payload from ${url}`);
	}
	return data as Record<string, unknown>;
}

async function fetchIkeaBinary(
	url: string,
	withClientId: boolean,
	signal?: AbortSignal
): Promise<Uint8Array> {
	const headers: HeadersInit = {
		Accept: '*/*',
		'User-Agent': USER_AGENT
	};
	if (withClientId) {
		headers['X-Client-Id'] = CLIENT_ID;
	}

	const response = await fetch(url, { headers, signal });
	if (!response.ok) {
		throw new Error(`IKEA download failed (${response.status}) for ${url}`);
	}
	return new Uint8Array(await response.arrayBuffer());
}

export class IkeaApiClient {
	constructor(
		private readonly country: string,
		private readonly language: string
	) {}

	private buildAbortSignal(): AbortSignal {
		return AbortSignal.timeout(TIMEOUT_MS);
	}

	async search(query: string): Promise<IkeaSearchProduct[]> {
		const trimmed = query.trim();
		if (!trimmed) return [];

		const params = buildSearchParams(trimmed);
		const url = `https://sik.search.blue.cdtapps.com/${this.country}/${this.language}/search-result-page?${params.toString()}`;
		const root = await fetchIkeaJson(url, false, this.buildAbortSignal());

		const searchResultPage = root.searchResultPage as Record<string, unknown> | undefined;
		const products = searchResultPage?.products as Record<string, unknown> | undefined;
		const main = products?.main as Record<string, unknown> | undefined;
		const items = main?.items;
		if (!Array.isArray(items)) return [];

		const out: IkeaSearchProduct[] = [];
		for (const entry of items) {
			if (!entry || typeof entry !== 'object') continue;
			const product = (entry as Record<string, unknown>).product as
				| Record<string, unknown>
				| undefined;
			if (!product) continue;

			const itemNo = typeof product.itemNo === 'string' ? product.itemNo : null;
			const mainImageUrl = typeof product.mainImageUrl === 'string' ? product.mainImageUrl : null;
			const pipUrl = typeof product.pipUrl === 'string' ? product.pipUrl : null;
			if (!itemNo || !mainImageUrl || !pipUrl) continue;

			out.push({
				itemNo,
				name: typeof product.name === 'string' ? product.name : itemNo,
				typeName: typeof product.typeName === 'string' ? product.typeName : null,
				mainImageUrl,
				mainImageAlt: typeof product.mainImageAlt === 'string' ? product.mainImageAlt : null,
				pipUrl
			});
		}

		return out;
	}

	async modelExists(itemNo: string): Promise<boolean> {
		const compact = compactItemNo(itemNo);
		const url = `https://web-api.ikea.com/${this.country}/${this.language}/rotera/data/exists/${compact}/`;
		const root = await fetchIkeaJson(url, true, this.buildAbortSignal());
		return root.exists === true;
	}

	async getModelInfo(itemNo: string): Promise<IkeaModelInfo> {
		const compact = compactItemNo(itemNo);
		const url = `https://web-api.ikea.com/${this.country}/${this.language}/rotera/data/model/${compact}/`;
		const root = await fetchIkeaJson(url, true, this.buildAbortSignal());

		const modelUrl = typeof root.modelUrl === 'string' ? root.modelUrl : null;
		if (!modelUrl) {
			throw new Error(`No modelUrl in IKEA model response for ${compact}`);
		}

		return {
			modelUrl,
			productName: typeof root.productName === 'string' ? root.productName : null,
			widthMm: pickMeasurement(root.measurements, 'width'),
			depthMm: pickMeasurement(root.measurements, 'depth'),
			heightMm: pickMeasurement(root.measurements, 'height')
		};
	}

	async download(url: string): Promise<Uint8Array> {
		return fetchIkeaBinary(url, false, this.buildAbortSignal());
	}
}

export function isValidLocaleCode(value: string): boolean {
	return /^[a-z]{2}$/.test(value);
}
