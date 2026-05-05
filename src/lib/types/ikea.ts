export interface IkeaSearchProduct {
	itemNo: string;
	name: string;
	typeName: string | null;
	mainImageUrl: string;
	mainImageAlt: string | null;
	pipUrl: string;
}

export interface IkeaModelInfo {
	modelUrl: string;
	productName: string | null;
	widthMm: number | null;
	depthMm: number | null;
	heightMm: number | null;
}

export interface ApiErrorShape {
	error: string;
	details?: string;
}
