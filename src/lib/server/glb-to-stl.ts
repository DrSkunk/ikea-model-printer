import { NodeIO, type Document, type Node as GLTFNode } from '@gltf-transform/core';
import {
	EXTTextureWebP,
	KHRDracoMeshCompression,
	KHRTextureBasisu
} from '@gltf-transform/extensions';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import draco3d from 'draco3dgltf';

const MODE_TRIANGLES = 4;
const MODE_TRIANGLE_STRIP = 5;
const MODE_TRIANGLE_FAN = 6;
const MM_PER_METER = 1000;

let decoderModulePromise: Promise<unknown | null> | null = null;

async function loadDracoDecoderModule(): Promise<unknown | null> {
	if (!decoderModulePromise) {
		decoderModulePromise = (async () => {
			try {
				// Resolve and load the wasm explicitly so serverless bundlers include it.
				const require = createRequire(import.meta.url);
				const wasmPath = require.resolve('draco3dgltf/draco_decoder_gltf.wasm');
				const wasmBinary = await readFile(wasmPath);
				return await draco3d.createDecoderModule({
					wasmBinary: new Uint8Array(
						wasmBinary.buffer,
						wasmBinary.byteOffset,
						wasmBinary.byteLength
					),
					locateFile: (file) => (file === 'draco_decoder_gltf.wasm' ? wasmPath : file)
				});
			} catch {
				return null;
			}
		})();
	}

	return decoderModulePromise;
}

type Mat4 = [
	number,
	number,
	number,
	number,
	number,
	number,
	number,
	number,
	number,
	number,
	number,
	number,
	number,
	number,
	number,
	number
];

type Vec3 = [number, number, number];

function identityMatrix(): Mat4 {
	return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
}

function mulMat4(a: Mat4, b: Mat4): Mat4 {
	const out = new Array<number>(16).fill(0);
	for (let c = 0; c < 4; c += 1) {
		for (let row = 0; row < 4; row += 1) {
			let value = 0;
			for (let k = 0; k < 4; k += 1) {
				value += a[k * 4 + row] * b[c * 4 + k];
			}
			out[c * 4 + row] = value;
		}
	}
	return out as Mat4;
}

function transformPoint(m: Mat4, v: Vec3): Vec3 {
	const x = m[0] * v[0] + m[4] * v[1] + m[8] * v[2] + m[12];
	const y = m[1] * v[0] + m[5] * v[1] + m[9] * v[2] + m[13];
	const z = m[2] * v[0] + m[6] * v[1] + m[10] * v[2] + m[14];
	return [x, y, z];
}

function sub(a: Vec3, b: Vec3): Vec3 {
	return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function cross(a: Vec3, b: Vec3): Vec3 {
	return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

function normalize(v: Vec3): Vec3 {
	const len = Math.hypot(v[0], v[1], v[2]);
	if (len < 1e-12) return [0, 0, 1];
	return [v[0] / len, v[1] / len, v[2] / len];
}

function dot(a: Vec3, b: Vec3): number {
	return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function triangleArea(a: Vec3, b: Vec3, c: Vec3): number {
	const n = cross(sub(b, a), sub(c, a));
	return Math.hypot(n[0], n[1], n[2]) * 0.5;
}

/**
 * Build a column-major 4×4 rotation matrix that rotates unit vector `from` to unit vector `to`.
 * Compatible with the existing transformPoint() convention.
 */
function buildRotationMatrix(from: Vec3, to: Vec3): Mat4 {
	const d = dot(from, to);
	if (d > 1 - 1e-6) return identityMatrix();

	let axis: Vec3;
	let cosA: number;
	let sinA: number;

	if (d < -1 + 1e-6) {
		// Anti-parallel: pick any perpendicular axis for 180° rotation
		axis =
			Math.abs(from[0]) < 0.9
				? normalize(cross(from, [1, 0, 0]))
				: normalize(cross(from, [0, 1, 0]));
		cosA = -1;
		sinA = 0;
	} else {
		axis = normalize(cross(from, to));
		cosA = d;
		sinA = Math.sqrt(1 - cosA * cosA);
	}

	const [kx, ky, kz] = axis;
	const t = 1 - cosA;

	// Column-major Rodrigues rotation matrix
	return [
		cosA + t * kx * kx,
		t * kx * ky + sinA * kz,
		t * kx * kz - sinA * ky,
		0,
		t * kx * ky - sinA * kz,
		cosA + t * ky * ky,
		t * ky * kz + sinA * kx,
		0,
		t * kx * kz + sinA * ky,
		t * ky * kz - sinA * kx,
		cosA + t * kz * kz,
		0,
		0,
		0,
		0,
		1
	];
}

/** Remove triangles with near-zero area (degenerate faces). */
function removeDegenerates(triangles: Vec3[][]): Vec3[][] {
	return triangles.filter(([a, b, c]) => {
		const n = cross(sub(b, a), sub(c, a));
		return Math.hypot(n[0], n[1], n[2]) > 1e-10;
	});
}

/** Translate the entire model so its lowest Z vertex sits at Z = 0. */
function translateToFloor(triangles: Vec3[][]): Vec3[][] {
	let minZ = Infinity;
	for (const [a, b, c] of triangles) {
		if (a[2] < minZ) minZ = a[2];
		if (b[2] < minZ) minZ = b[2];
		if (c[2] < minZ) minZ = c[2];
	}
	if (!Number.isFinite(minZ) || Math.abs(minZ) < 1e-6) return triangles;
	return triangles.map(([a, b, c]) => [
		[a[0], a[1], a[2] - minZ],
		[b[0], b[1], b[2] - minZ],
		[c[0], c[1], c[2] - minZ]
	]);
}

const CANDIDATE_NORMALS: Vec3[] = [
	[1, 0, 0],
	[-1, 0, 0],
	[0, 1, 0],
	[0, -1, 0],
	[0, 0, 1],
	[0, 0, -1]
];

/**
 * Rotate the model so its largest flat face rests on the print bed (Z = 0 plane).
 * Finds the dominant surface normal by area-weighted clustering into 6 axis directions,
 * then rotates that normal to point toward −Z (into the bed).
 */
function autoOrient(triangles: Vec3[][]): Vec3[][] {
	const scores = new Array<number>(CANDIDATE_NORMALS.length).fill(0);

	for (const [a, b, c] of triangles) {
		const n = normalize(cross(sub(b, a), sub(c, a)));
		const area = triangleArea(a, b, c);

		let bestIdx = 0;
		let bestDot = -Infinity;
		for (let i = 0; i < CANDIDATE_NORMALS.length; i++) {
			const d = dot(n, CANDIDATE_NORMALS[i]);
			if (d > bestDot) {
				bestDot = d;
				bestIdx = i;
			}
		}
		scores[bestIdx] += area;
	}

	let dominantIdx = 0;
	for (let i = 1; i < CANDIDATE_NORMALS.length; i++) {
		if (scores[i] > scores[dominantIdx]) dominantIdx = i;
	}

	const dominantNormal = CANDIDATE_NORMALS[dominantIdx];
	const targetDown: Vec3 = [0, 0, -1];

	// Already facing into the bed — nothing to do
	if (dot(dominantNormal, targetDown) > 0.9999) return triangles;

	const rot = buildRotationMatrix(dominantNormal, targetDown);
	return triangles.map(([a, b, c]) => [
		transformPoint(rot, a),
		transformPoint(rot, b),
		transformPoint(rot, c)
	]);
}

export interface ConvertOptions {
	/** When true, apply Z-floor translation, degenerate removal, and auto-orientation. */
	optimize?: boolean;
}

function expandIndices(indices: number[], mode: number): number[] {
	if (mode === MODE_TRIANGLES) return indices;
	const out: number[] = [];
	if (mode === MODE_TRIANGLE_STRIP) {
		for (let i = 0; i + 2 < indices.length; i += 1) {
			if ((i & 1) === 0) {
				out.push(indices[i], indices[i + 1], indices[i + 2]);
			} else {
				out.push(indices[i], indices[i + 2], indices[i + 1]);
			}
		}
	}
	if (mode === MODE_TRIANGLE_FAN) {
		for (let i = 1; i + 1 < indices.length; i += 1) {
			out.push(indices[0], indices[i], indices[i + 1]);
		}
	}
	return out;
}

function writeBinaryStl(triangles: Vec3[][]): Uint8Array {
	const out = new ArrayBuffer(84 + triangles.length * 50);
	const view = new DataView(out);
	view.setUint32(80, triangles.length, true);
	let offset = 84;

	for (const triangle of triangles) {
		const a = triangle[0];
		const b = triangle[1];
		const c = triangle[2];
		const normal = normalize(cross(sub(b, a), sub(c, a)));

		const values = [
			normal[0],
			normal[1],
			normal[2],
			a[0],
			a[1],
			a[2],
			b[0],
			b[1],
			b[2],
			c[0],
			c[1],
			c[2]
		];
		for (const value of values) {
			view.setFloat32(offset, value, true);
			offset += 4;
		}
		view.setUint16(offset, 0, true);
		offset += 2;
	}

	return new Uint8Array(out);
}

function composeMatrix(node: GLTFNode): Mat4 {
	// getMatrix() returns null for TRS-decomposed nodes (the glTF default).
	// Compose column-major 4×4 from T/R/S instead.
	const explicit = node.getMatrix() as number[] | null;
	if (explicit) return explicit as Mat4;

	const [tx, ty, tz] = node.getTranslation() as [number, number, number];
	const [qx, qy, qz, qw] = node.getRotation() as [number, number, number, number];
	const [sx, sy, sz] = node.getScale() as [number, number, number];

	// Quaternion → rotation matrix (column-major)
	const x2 = qx + qx,
		y2 = qy + qy,
		z2 = qz + qz;
	const xx = qx * x2,
		xy = qx * y2,
		xz = qx * z2;
	const yy = qy * y2,
		yz = qy * z2,
		zz = qz * z2;
	const wx = qw * x2,
		wy = qw * y2,
		wz = qw * z2;

	return [
		(1 - (yy + zz)) * sx,
		(xy + wz) * sx,
		(xz - wy) * sx,
		0,
		(xy - wz) * sy,
		(1 - (xx + zz)) * sy,
		(yz + wx) * sy,
		0,
		(xz + wy) * sz,
		(yz - wx) * sz,
		(1 - (xx + yy)) * sz,
		0,
		tx,
		ty,
		tz,
		1
	];
}

function collectTriangles(
	node: GLTFNode,
	parentWorld: Mat4,
	triangles: Vec3[][],
	scale: number
): void {
	const localMatrix = composeMatrix(node);
	const world = mulMat4(parentWorld, localMatrix);

	const mesh = node.getMesh?.();
	if (mesh) {
		for (const primitive of mesh.listPrimitives()) {
			const positionAccessor = primitive.getAttribute('POSITION');
			if (!positionAccessor) continue;

			const array = positionAccessor.getArray() as ArrayLike<number>;
			const vertexCount = positionAccessor.getCount();
			if (!array || vertexCount === 0) continue;

			const indicesAccessor = primitive.getIndices?.();
			const rawIndices = indicesAccessor
				? Array.from(indicesAccessor.getArray() as ArrayLike<number>, (value) => Number(value))
				: Array.from({ length: vertexCount }, (_, index) => index);

			const mode = Number(primitive.getMode?.() ?? MODE_TRIANGLES);
			const indices = expandIndices(rawIndices, mode);
			if (indices.length < 3) continue;

			for (let i = 0; i + 2 < indices.length; i += 3) {
				const ai = indices[i] * 3;
				const bi = indices[i + 1] * 3;
				const ci = indices[i + 2] * 3;

				const a = transformPoint(world, [
					Number(array[ai]),
					Number(array[ai + 1]),
					Number(array[ai + 2])
				]);
				const b = transformPoint(world, [
					Number(array[bi]),
					Number(array[bi + 1]),
					Number(array[bi + 2])
				]);
				const c = transformPoint(world, [
					Number(array[ci]),
					Number(array[ci + 1]),
					Number(array[ci + 2])
				]);

				triangles.push([
					[a[0] * scale, a[1] * scale, a[2] * scale],
					[b[0] * scale, b[1] * scale, b[2] * scale],
					[c[0] * scale, c[1] * scale, c[2] * scale]
				]);
			}
		}
	}

	for (const child of node.listChildren()) {
		collectTriangles(child, world, triangles, scale);
	}
}

const SUPPORTED_EXTENSIONS = new Set([
	'KHR_draco_mesh_compression',
	'EXT_texture_webp',
	'KHR_texture_basisu'
]);

function hasUnsupportedRequiredExtension(document: Document): string | null {
	for (const ext of document.getRoot().listExtensionsRequired()) {
		if (!SUPPORTED_EXTENSIONS.has(ext.extensionName)) {
			return `Model uses unsupported required extension: ${ext.extensionName}`;
		}
	}
	return null;
}

const GLB_MAGIC = 0x46546c67; // "glTF"
const GLB_JSON_CHUNK_TYPE = 0x4e4f534a; // "JSON"

function getGlbExtensionsRequired(glbBytes: Uint8Array): string[] {
	if (glbBytes.byteLength < 20) return [];
	const view = new DataView(glbBytes.buffer, glbBytes.byteOffset, glbBytes.byteLength);
	if (view.getUint32(0, true) !== GLB_MAGIC) return [];
	const chunkLength = view.getUint32(12, true);
	const chunkType = view.getUint32(16, true);
	if (chunkType !== GLB_JSON_CHUNK_TYPE || glbBytes.byteLength < 20 + chunkLength) return [];
	try {
		const json = JSON.parse(
			new TextDecoder().decode(glbBytes.slice(20, 20 + chunkLength))
		) as Record<string, unknown>;
		const required = json.extensionsRequired;
		if (Array.isArray(required)) {
			return required.filter((x): x is string => typeof x === 'string');
		}
	} catch {
		// ignore parse errors
	}
	return [];
}

async function buildIo(): Promise<NodeIO> {
	const decoderModule = await loadDracoDecoderModule();
	const io = new NodeIO().registerExtensions(
		decoderModule
			? [KHRDracoMeshCompression, EXTTextureWebP, KHRTextureBasisu]
			: [EXTTextureWebP, KHRTextureBasisu]
	);
	if (decoderModule) {
		io.registerDependencies({
			'draco3d.decoder': decoderModule
		});
	}
	return io;
}

export async function convertGlbToStl(
	glbBytes: Uint8Array,
	scale = MM_PER_METER,
	options: ConvertOptions = {}
): Promise<Uint8Array> {
	const { optimize = false } = options;

	const decoderModule = await loadDracoDecoderModule();
	if (!decoderModule) {
		const requiredExts = getGlbExtensionsRequired(glbBytes);
		if (requiredExts.includes('KHR_draco_mesh_compression')) {
			throw new Error(
				'This model uses Draco mesh compression, but the Draco decoder is unavailable in this environment.'
			);
		}
	}

	const io = await buildIo();
	const document = await io.readBinary(glbBytes);

	const unsupported = hasUnsupportedRequiredExtension(document);
	if (unsupported) {
		throw new Error(unsupported);
	}

	let triangles: Vec3[][] = [];
	for (const scene of document.getRoot().listScenes()) {
		for (const node of scene.listChildren()) {
			collectTriangles(node, identityMatrix(), triangles, scale);
		}
	}

	if (triangles.length === 0) {
		throw new Error('No triangle geometry found in GLB model.');
	}

	if (optimize) {
		triangles = removeDegenerates(triangles);
		triangles = autoOrient(triangles);
		triangles = translateToFloor(triangles);
	}

	return writeBinaryStl(triangles);
}
