<script lang="ts">
	import { onDestroy, onMount } from 'svelte';
	import type * as THREE_TYPES from 'three';
	import type { OrbitControls as OrbitControlsType } from 'three/addons/controls/OrbitControls.js';

	interface Props {
		itemNo: string;
		country: string;
		language: string;
		scaleDenominator: number;
		onClose: () => void;
	}

	let { itemNo, country, language, scaleDenominator, onClose }: Props = $props();

	let originalWrap: HTMLDivElement | undefined = $state();
	let optimizedWrap: HTMLDivElement | undefined = $state();
	let originalCanvas: HTMLCanvasElement | undefined = $state();
	let optimizedCanvas: HTMLCanvasElement | undefined = $state();
	let originalLoading = $state(true);
	let optimizedLoading = $state(true);
	let originalError = $state('');
	let optimizedError = $state('');

	const cleanupFns: Array<() => void> = [];

	function makeStlUrl(optimize: boolean): string {
		const params = new URLSearchParams({
			itemNo,
			country,
			language,
			scaleDenominator: String(scaleDenominator),
			optimize: String(optimize)
		});
		return `/api/convert?${params.toString()}`;
	}

	async function setupViewer(
		wrap: HTMLDivElement,
		canvas: HTMLCanvasElement,
		url: string,
		setLoading: (v: boolean) => void,
		setError: (v: string) => void
	): Promise<() => void> {
		const THREE = await import('three');
		const { OrbitControls } = await import('three/addons/controls/OrbitControls.js');
		const { STLLoader } = await import('three/addons/loaders/STLLoader.js');

		type RendererType = THREE_TYPES.WebGLRenderer;
		type ControlsType = OrbitControlsType;

		const W = wrap.clientWidth || 480;
		const H = wrap.clientHeight || 360;

		const scene = new THREE.Scene();
		scene.background = new THREE.Color(0xf0f0f0);

		const camera = new THREE.PerspectiveCamera(45, W / H, 0.01, 1e7);

		const renderer: RendererType = new THREE.WebGLRenderer({ canvas, antialias: true });
		renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
		renderer.setSize(W, H, false);

		// Lighting
		scene.add(new THREE.AmbientLight(0xffffff, 0.6));
		const dir1 = new THREE.DirectionalLight(0xffffff, 1.0);
		dir1.position.set(1, 2, 2);
		scene.add(dir1);
		const dir2 = new THREE.DirectionalLight(0xffffff, 0.4);
		dir2.position.set(-1, -0.5, 1);
		scene.add(dir2);

		// Placeholders that will be resized after model loads
		const grid = new THREE.GridHelper(1000, 20, 0xbbbbbb, 0xdddddd);
		scene.add(grid);

		const bedGeo = new THREE.PlaneGeometry(1000, 1000);
		const bedMat = new THREE.MeshBasicMaterial({
			color: 0xddeeff,
			transparent: true,
			opacity: 0.35,
			side: THREE.DoubleSide,
			depthWrite: false
		});
		const bedPlane = new THREE.Mesh(bedGeo, bedMat);
		scene.add(bedPlane);

		const controls: ControlsType = new OrbitControls(camera, canvas);
		controls.enableDamping = true;
		controls.dampingFactor = 0.1;
		controls.screenSpacePanning = false;

		let animFrameId: number;
		let geometry: THREE_TYPES.BufferGeometry | null = null;
		let meshObj: THREE_TYPES.Mesh | null = null;

		try {
			const response = await fetch(url);
			if (!response.ok) {
				let msg = `HTTP ${response.status}`;
				try {
					const payload = (await response.json()) as { details?: string; error?: string };
					msg = payload.details ?? payload.error ?? msg;
				} catch {
					/* ignore */
				}
				throw new Error(msg);
			}

			const buffer = await response.arrayBuffer();
			const loader = new STLLoader();
			geometry = loader.parse(buffer);

			// Our STL pipeline outputs a Z-up model (print bed at Z=0, part builds toward +Z).
			// Three.js uses Y-up by default, so rotate –90° around X to convert Z-up → Y-up.
			geometry.applyMatrix4(new THREE.Matrix4().makeRotationX(-Math.PI / 2));
			geometry.computeVertexNormals();
			geometry.computeBoundingBox();

			const bbox = geometry.boundingBox!;
			const center = new THREE.Vector3();
			bbox.getCenter(center);
			const size = new THREE.Vector3();
			bbox.getSize(size);
			const maxDim = Math.max(size.x, size.y, size.z) || 1;

			// Centre horizontally (X/Z) so the model sits at the origin, but keep the bottom
			// face flush with Y = 0 (the print-bed plane) by translating only to bbox.min.y.
			geometry.translate(-center.x, -bbox.min.y, -center.z);

			const material = new THREE.MeshPhongMaterial({
				color: 0xc8c8c8,
				specular: 0x333333,
				shininess: 25,
				side: THREE.DoubleSide
			});
			meshObj = new THREE.Mesh(geometry, material);
			scene.add(meshObj);

			// Resize grid / bed to fit model
			const gs = maxDim * 3;
			grid.scale.setScalar(gs / 1000);
			bedPlane.geometry.dispose();
			bedPlane.geometry = new THREE.PlaneGeometry(gs, gs);

			// Position camera
			const dist = maxDim * 2.2;
			camera.position.set(dist * 0.7, dist * 0.9, dist * 0.6);
			camera.near = maxDim * 0.001;
			camera.far = maxDim * 200;
			camera.up.set(0, 1, 0);
			camera.updateProjectionMatrix();

			controls.target.set(0, size.y / 2, 0);
			controls.update();

			setLoading(false);
		} catch (err) {
			setLoading(false);
			setError(err instanceof Error ? err.message : 'Failed to load model');
		}

		// Animation loop (run even on error so controls still work if needed)
		const animate = () => {
			animFrameId = requestAnimationFrame(animate);
			controls.update();
			renderer.render(scene, camera);
		};
		animate();

		// Resize observer
		const resizeObserver = new ResizeObserver(() => {
			const w = wrap.clientWidth;
			const h = wrap.clientHeight;
			if (w > 0 && h > 0) {
				camera.aspect = w / h;
				camera.updateProjectionMatrix();
				renderer.setSize(w, h, false);
			}
		});
		resizeObserver.observe(wrap);

		return () => {
			cancelAnimationFrame(animFrameId);
			resizeObserver.disconnect();
			controls.dispose();
			renderer.dispose();
			geometry?.dispose();
			if (meshObj) {
				(meshObj.material as THREE_TYPES.Material).dispose();
			}
			bedMat.dispose();
		};
	}

	onMount(async () => {
		const tasks: Array<Promise<() => void>> = [];

		if (originalWrap && originalCanvas) {
			tasks.push(
				setupViewer(
					originalWrap,
					originalCanvas,
					makeStlUrl(false),
					(v) => {
						originalLoading = v;
					},
					(v) => {
						originalError = v;
					}
				)
			);
		}
		if (optimizedWrap && optimizedCanvas) {
			tasks.push(
				setupViewer(
					optimizedWrap,
					optimizedCanvas,
					makeStlUrl(true),
					(v) => {
						optimizedLoading = v;
					},
					(v) => {
						optimizedError = v;
					}
				)
			);
		}

		const cleanups = await Promise.all(tasks);
		cleanupFns.push(...cleanups);
	});

	onDestroy(() => {
		for (const fn of cleanupFns) fn();
	});

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') onClose();
	}
</script>

<svelte:window onkeydown={handleKeydown} />

<!-- Backdrop -->
<div
	class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-2 sm:p-4"
	role="dialog"
	aria-modal="true"
	aria-label="3D model preview"
>
	<!-- Panel -->
	<div
		class="flex max-h-[95vh] w-full max-w-5xl flex-col overflow-hidden rounded-xl bg-white shadow-2xl"
	>
		<!-- Header -->
		<div class="flex shrink-0 items-center justify-between border-b border-border px-5 py-3">
			<h2 class="text-sm font-bold text-ink">3D Preview — Art. no. {itemNo}</h2>
			<button
				type="button"
				onclick={onClose}
				class="flex h-8 w-8 cursor-pointer items-center justify-center rounded text-ink-muted transition-colors hover:bg-surface-hover hover:text-ink"
				aria-label="Close preview"
			>
				<svg class="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
					<path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
				</svg>
			</button>
		</div>

		<!-- Viewers -->
		<div class="grid min-h-0 flex-1 grid-cols-1 gap-px bg-border sm:grid-cols-2">
			<!-- Original -->
			<div class="flex flex-col bg-white">
				<div class="shrink-0 border-b border-border px-4 py-2">
					<p class="text-xs font-semibold text-ink">Original</p>
					<p class="text-[0.65rem] text-ink-muted">Direct GLB → STL, no adjustments</p>
				</div>
				<div bind:this={originalWrap} class="relative h-[340px] sm:h-[400px]">
					{#if originalLoading}
						<div class="absolute inset-0 flex items-center justify-center">
							<svg class="h-6 w-6 animate-spin text-ikea-blue" fill="none" viewBox="0 0 24 24">
								<circle
									class="opacity-20"
									cx="12"
									cy="12"
									r="10"
									stroke="currentColor"
									stroke-width="3"
								></circle>
								<path
									class="opacity-80"
									fill="currentColor"
									d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
								></path>
							</svg>
						</div>
					{/if}
					{#if originalError}
						<div
							class="absolute inset-0 flex items-center justify-center p-6 text-center text-xs text-[#c0392b]"
						>
							{originalError}
						</div>
					{/if}
					<canvas
						bind:this={originalCanvas}
						class="block h-full w-full {originalLoading || originalError ? 'invisible' : ''}"
					></canvas>
				</div>
			</div>

			<!-- Optimised -->
			<div class="flex flex-col bg-white">
				<div class="shrink-0 border-b border-border px-4 py-2">
					<p class="text-xs font-semibold text-ikea-blue">Optimised for printing</p>
					<p class="text-[0.65rem] text-ink-muted">
						Auto-oriented · floor at Z = 0 · degenerates removed
					</p>
				</div>
				<div bind:this={optimizedWrap} class="relative h-[340px] sm:h-[400px]">
					{#if optimizedLoading}
						<div class="absolute inset-0 flex items-center justify-center">
							<svg class="h-6 w-6 animate-spin text-ikea-blue" fill="none" viewBox="0 0 24 24">
								<circle
									class="opacity-20"
									cx="12"
									cy="12"
									r="10"
									stroke="currentColor"
									stroke-width="3"
								></circle>
								<path
									class="opacity-80"
									fill="currentColor"
									d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
								></path>
							</svg>
						</div>
					{/if}
					{#if optimizedError}
						<div
							class="absolute inset-0 flex items-center justify-center p-6 text-center text-xs text-[#c0392b]"
						>
							{optimizedError}
						</div>
					{/if}
					<canvas
						bind:this={optimizedCanvas}
						class="block h-full w-full {optimizedLoading || optimizedError ? 'invisible' : ''}"
					></canvas>
				</div>
			</div>
		</div>

		<!-- Footer hint -->
		<div class="shrink-0 border-t border-border bg-bg px-5 py-2 text-[0.65rem] text-ink-muted">
			Drag to rotate · Scroll to zoom · Right-click / two-finger drag to pan
		</div>
	</div>
</div>
