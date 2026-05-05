<script lang="ts">
	import { onMount } from 'svelte';
	import type { ApiErrorShape, IkeaModelInfo, IkeaSearchProduct } from '$lib/types/ikea';

	let query = $state('');
	let country = $state('us');
	let language = $state('en');
	let loading = $state(false);
	let convertingItemNo = $state<string | null>(null);
	let products = $state<IkeaSearchProduct[]>([]);
	let errorMessage = $state('');
	let scaleDenominator = $state(20);
	let searchInput: HTMLInputElement | null = null;
	let dimensionsByItemNo = $state<Record<string, IkeaModelInfo>>({});
	const SCALE_STORAGE_KEY = 'ikea-scale-denominator';

	const hasResults = $derived(products.length > 0);

	function clampScaleDenominator(value: number): number {
		if (!Number.isFinite(value)) return 20;
		return Math.max(1, Math.min(1000, Math.round(value)));
	}

	onMount(() => {
		const stored = Number(window.localStorage.getItem(SCALE_STORAGE_KEY));
		scaleDenominator = clampScaleDenominator(stored);
		searchInput?.focus();
	});

	$effect(() => {
		const normalizedScale = clampScaleDenominator(Number(scaleDenominator));
		if (normalizedScale !== scaleDenominator) {
			scaleDenominator = normalizedScale;
			return;
		}

		window.localStorage.setItem(SCALE_STORAGE_KEY, String(normalizedScale));
	});

	async function loadDimensions(items: IkeaSearchProduct[]): Promise<void> {
		const localeCountry = country.trim().toLowerCase();
		const localeLanguage = language.trim().toLowerCase();
		const updates: Record<string, IkeaModelInfo> = {};

		await Promise.all(
			items.map(async (item) => {
				try {
					const params = new URLSearchParams({
						itemNo: item.itemNo,
						country: localeCountry,
						language: localeLanguage
					});
					const response = await fetch(`/api/model-info?${params.toString()}`);
					if (!response.ok) return;

					const payload = (await response.json()) as
						| { exists: true; info: IkeaModelInfo }
						| { exists: false };
					if (payload.exists) {
						updates[item.itemNo] = payload.info;
					}
				} catch {
					// Keep UI responsive even if some lookups fail.
				}
			})
		);

		dimensionsByItemNo = updates;
	}

	function formatMm(value: number | null): string {
		if (value === null) return 'n/a';
		return `${Math.round(value)} mm`;
	}

	function scaledMm(value: number | null): number | null {
		if (value === null) return null;
		return value / scaleDenominator;
	}

	async function searchProducts(event: SubmitEvent): Promise<void> {
		event.preventDefault();
		errorMessage = '';
		products = [];
		dimensionsByItemNo = {};

		if (!query.trim()) {
			errorMessage = 'Type a product name or IKEA item number first.';
			return;
		}

		loading = true;
		try {
			const params = new URLSearchParams({
				q: query.trim(),
				country: country.trim().toLowerCase(),
				language: language.trim().toLowerCase()
			});
			const response = await fetch(`/api/search?${params.toString()}`);
			if (!response.ok) {
				const payload = (await response.json()) as ApiErrorShape;
				throw new Error(payload.details ?? payload.error ?? 'Search failed');
			}

			const payload = (await response.json()) as { products: IkeaSearchProduct[] };
			products = payload.products;
			void loadDimensions(payload.products);
			if (payload.products.length === 0) {
				errorMessage = 'No products found. Try a broader search or switch locale.';
			}
		} catch (error) {
			errorMessage = error instanceof Error ? error.message : 'Search failed';
		} finally {
			loading = false;
		}
	}

	async function downloadStl(itemNo: string): Promise<void> {
		errorMessage = '';
		convertingItemNo = itemNo;

		try {
			const clampedScaleDenominator = clampScaleDenominator(Number(scaleDenominator));
			scaleDenominator = clampedScaleDenominator;

			const params = new URLSearchParams({
				itemNo,
				country: country.trim().toLowerCase(),
				language: language.trim().toLowerCase(),
				scaleDenominator: String(clampedScaleDenominator)
			});
			const response = await fetch(`/api/convert?${params.toString()}`);
			if (!response.ok) {
				const payload = (await response.json()) as ApiErrorShape;
				throw new Error(payload.details ?? payload.error ?? 'Conversion failed');
			}

			const blob = await response.blob();
			const link = document.createElement('a');
			const url = URL.createObjectURL(blob);
			link.href = url;
			link.download = `ikea-${itemNo.replace(/\D/g, '')}-1-${clampedScaleDenominator}.stl`;
			document.body.appendChild(link);
			link.click();
			link.remove();
			URL.revokeObjectURL(url);
		} catch (error) {
			errorMessage = error instanceof Error ? error.message : 'Conversion failed';
		} finally {
			convertingItemNo = null;
		}
	}

	function openProductPage(url: string): void {
		window.open(url, '_blank', 'noopener,noreferrer');
	}
</script>

<svelte:head>
	<title>IKEA 3D Model Printer – STL Exporter</title>
	<meta
		name="description"
		content="Search IKEA products, fetch 3D models, and convert them to slicer-ready STL files."
	/>
</svelte:head>

<div class="flex min-h-screen flex-col bg-bg font-[var(--font-sans)]">
	<!-- ─── Header ─── -->
	<header class="border-b border-border bg-surface">
		<div class="mx-auto max-w-[1400px] px-4 py-4 sm:px-8">
			<!-- Search bar -->
			<form
				onsubmit={searchProducts}
				class="flex items-center gap-0 overflow-hidden rounded-full border border-border-strong bg-white shadow-[0_1px_2px_rgba(0,0,0,0.06)] focus-within:border-ikea-blue focus-within:ring-1 focus-within:ring-ikea-blue"
			>
				<input
					id="search-query"
					bind:this={searchInput}
					bind:value={query}
					placeholder="Search products – try BILLY, PAX, KALLAX…"
					class="flex-1 bg-transparent px-5 py-3 text-sm text-ink placeholder:text-ink-muted focus:outline-none"
				/>

				<div class="flex items-center gap-0 pr-1">
					<!-- Country -->
					<input
						bind:value={country}
						maxlength="2"
						minlength="2"
						placeholder="us"
						title="Country code"
						class="w-10 bg-transparent py-3 text-center text-xs text-ink-muted uppercase focus:outline-none"
					/>
					<span class="text-xs text-ink-subtle">/</span>
					<!-- Language -->
					<input
						bind:value={language}
						maxlength="2"
						minlength="2"
						placeholder="en"
						title="Language code"
						class="w-10 bg-transparent py-3 text-center text-xs text-ink-muted uppercase focus:outline-none"
					/>

					<!-- Search button -->
					<button
						type="submit"
						disabled={loading}
						class="mr-1 flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-full bg-ink text-white transition-opacity hover:opacity-80 disabled:cursor-not-allowed disabled:opacity-50"
						aria-label="Search"
					>
						{#if loading}
							<svg class="h-3.5 w-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
								<circle
									class="opacity-30"
									cx="12"
									cy="12"
									r="10"
									stroke="currentColor"
									stroke-width="4"
								></circle>
								<path
									class="opacity-80"
									fill="currentColor"
									d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
								></path>
							</svg>
						{:else}
							<svg
								class="h-4 w-4"
								fill="none"
								stroke="currentColor"
								viewBox="0 0 24 24"
								stroke-width="2.5"
							>
								<path
									stroke-linecap="round"
									stroke-linejoin="round"
									d="M21 21l-4.35-4.35M17 11A6 6 0 1 1 5 11a6 6 0 0 1 12 0z"
								/>
							</svg>
						{/if}
					</button>
				</div>
			</form>

			<!-- Scale control -->
			<div
				class="mt-3 rounded-xl border border-border bg-white px-3 py-2 shadow-[0_1px_2px_rgba(0,0,0,0.04)]"
			>
				<div class="flex items-center justify-between gap-3">
					<label for="scale-slider" class="text-xs font-medium text-ink-secondary"
						>Scale 1:{scaleDenominator}</label
					>
					<div class="flex items-center gap-1.5">
						<span class="text-xs text-ink-muted">1 /</span>
						<input
							id="scale-denominator"
							type="number"
							bind:value={scaleDenominator}
							min="1"
							max="1000"
							step="1"
							class="w-[4.5rem] rounded border border-border-strong bg-white px-2 py-1 text-center text-xs text-ink focus:border-ikea-blue focus:outline-none"
						/>
					</div>
				</div>
				<input
					id="scale-slider"
					type="range"
					bind:value={scaleDenominator}
					min="1"
					max="200"
					step="1"
					class="mt-2 h-2 w-full cursor-pointer accent-ikea-blue"
				/>
			</div>
		</div>
	</header>

	<!-- ─── Main ─── -->
	<main class="mx-auto w-full max-w-[1400px] flex-1 px-4 py-8 sm:px-8">
		<!-- Page title / intro -->
		<div class="animate-rise mb-6">
			<h1 class="text-xl font-bold text-ink">3D Model Printer</h1>
			<p class="mt-1 text-sm text-ink-muted">
				Search any IKEA product and download its official 3D model as a printable STL file.
			</p>
		</div>

		<!-- Error -->
		{#if errorMessage}
			<div
				class="animate-rise-2 mb-6 flex items-start gap-3 rounded border border-[#e8b9b3] bg-[#fdf3f2] px-4 py-3 text-sm text-[#c0392b]"
			>
				<svg class="mt-0.5 h-4 w-4 shrink-0" fill="currentColor" viewBox="0 0 20 20">
					<path
						fill-rule="evenodd"
						d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z"
						clip-rule="evenodd"
					/>
				</svg>
				<span>{errorMessage}</span>
			</div>
		{/if}

		<!-- Results -->
		{#if hasResults}
			<div class="animate-rise-3">
				<p class="mb-4 text-sm text-ink-muted">
					{products.length} result{products.length === 1 ? '' : 's'}
				</p>

				<div class="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
					{#each products as product (product.itemNo)}
						{@const dims = dimensionsByItemNo[product.itemNo]}
						<article class="group flex flex-col bg-surface">
							<!-- Image -->
							<div
								role="button"
								tabindex="-1"
								onclick={() => openProductPage(product.pipUrl)}
								onkeypress={() => openProductPage(product.pipUrl)}
								class="block cursor-pointer overflow-hidden bg-bg"
							>
								<img
									src={product.mainImageUrl}
									alt={product.mainImageAlt ?? product.name}
									loading="lazy"
									class="aspect-square w-full object-cover transition-transform duration-300 group-hover:scale-[1.04]"
								/>
							</div>

							<!-- Info -->
							<div class="flex flex-1 flex-col px-0 pt-3 pb-4">
								<p class="text-[0.7rem] font-medium tracking-wide text-ink-muted uppercase">
									{product.typeName ?? 'Product'}
								</p>
								<h2 class="mt-0.5 text-sm leading-snug font-bold text-ink">
									{product.name}
								</h2>
								<p class="mt-1 text-[0.7rem] text-ink-muted" style="font-family: var(--font-mono)">
									Art. no. {product.itemNo}
								</p>
								{#if dims && (dims.widthMm !== null || dims.depthMm !== null || dims.heightMm !== null)}
									<p class="mt-1 text-[0.7rem] leading-relaxed text-ink-muted">
										Real: {formatMm(dims.widthMm)} × {formatMm(dims.depthMm)} × {formatMm(
											dims.heightMm
										)}
									</p>
									<p class="text-[0.7rem] leading-relaxed text-ink-secondary">
										Scaled (1:{scaleDenominator}): {formatMm(scaledMm(dims.widthMm))} × {formatMm(
											scaledMm(dims.depthMm)
										)} × {formatMm(scaledMm(dims.heightMm))}
									</p>
								{/if}

								<div class="mt-3 flex flex-col gap-2">
									<!-- Primary: Download STL -->
									<button
										type="button"
										onclick={() => downloadStl(product.itemNo)}
										disabled={convertingItemNo === product.itemNo || convertingItemNo !== null}
										class="flex w-full cursor-pointer items-center justify-center gap-2 rounded bg-ink px-3 py-2.5 text-xs font-bold text-white transition-colors hover:bg-ink-secondary disabled:cursor-not-allowed disabled:opacity-50"
									>
										{#if convertingItemNo === product.itemNo}
											<svg
												class="h-3.5 w-3.5 shrink-0 animate-spin"
												fill="none"
												viewBox="0 0 24 24"
											>
												<circle
													class="opacity-25"
													cx="12"
													cy="12"
													r="10"
													stroke="currentColor"
													stroke-width="4"
												></circle>
												<path
													class="opacity-75"
													fill="currentColor"
													d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
												></path>
											</svg>
											Converting…
										{:else}
											<svg
												class="h-3.5 w-3.5 shrink-0"
												fill="none"
												stroke="currentColor"
												viewBox="0 0 24 24"
												stroke-width="2.5"
											>
												<path
													stroke-linecap="round"
													stroke-linejoin="round"
													d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
												/>
											</svg>
											Download STL
										{/if}
									</button>

									<!-- Secondary: View on IKEA -->
									<button
										type="button"
										onclick={() => openProductPage(product.pipUrl)}
										class="w-full cursor-pointer rounded border border-border-strong px-3 py-2 text-xs font-medium text-ink-secondary transition-colors hover:border-ikea-blue hover:text-ikea-blue"
									>
										View on IKEA.com
									</button>
								</div>
							</div>
						</article>
					{/each}
				</div>
			</div>
		{/if}
	</main>

	<!-- ─── Footer ─── -->
	<footer class="border-t border-border bg-surface">
		<div class="mx-auto max-w-[1400px] px-4 py-8 sm:px-8">
			<p class="text-xs text-ink-muted">
				Not affiliated with IKEA · Models sourced from the IKEA 3D viewer API
			</p>
			<p class="mt-1 text-xs text-ink-subtle">© Inter IKEA Systems B.V. 1999–2026</p>
		</div>
	</footer>
</div>
