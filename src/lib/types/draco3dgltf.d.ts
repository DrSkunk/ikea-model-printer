declare module 'draco3dgltf' {
	interface DracoDecoderModuleOptions {
		wasmBinary?: Uint8Array;
		locateFile?: (file: string, prefix: string) => string;
	}

	interface DracoModuleFactory {
		createDecoderModule(options?: DracoDecoderModuleOptions): Promise<unknown>;
	}

	const factory: DracoModuleFactory;
	export default factory;
}
