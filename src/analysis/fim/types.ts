export interface CoverageMatrix {
  matrix: number[][];
  testIds: string[];
  fileIds: string[];
}

export interface FisherInformationResult {
  eigenvalues: number[];
  conditionNumber: number;
  effectiveDimension: number;
  fileCount: number;
  testCount: number;
  diagonal: Array<{ fileId: string; selfInfo: number }>;
  uncoveredFiles: string[];
  fragilityHotspots: Array<{ fileId: string; selfInfo: number; crb: number }>;
}

export interface FIMSnapshot {
  timestamp: string;
  commitSha?: string;
  source: 'import-approximation' | 'per-test-coverage' | 'mutation';
  fileCount: number;
  testCount: number;
  descriptionLength?: number;
  conditionNumber: number;
  effectiveDimension: number;
  /** κ after excluding non-production packages */
  filteredConditionNumber?: number;
  /** N_eff after excluding non-production packages */
  filteredEffectiveDimension?: number;
  /** Eigenvalue share distribution for all packages (including non-production) */
  topEigenvalueShares: number[];
  /** Eigenvalue share distribution for production packages only — consistent with filteredConditionNumber */
  filteredTopEigenvalueShares?: number[];
  uncoveredFileCount: number;
  mantelCorrelation?: number;
  mantelPValue?: number;
}

export interface PackageFIM {
  matrix: number[][];
  packageNames: string[];
}

export interface FIMCurrentArtifact {
  timestamp: string;
  source: FIMSnapshot['source'];
  descriptionLength: number;
  fileIds: string[];
  packageNames: string[];
  fileMatrix: number[][];
  packageMatrix: number[][];
  /** Gram matrix restricted to production packages only — use this for Mantel validation */
  filteredPackageMatrix: number[][];
  fileResult: FisherInformationResult;
  packageResult: FisherInformationResult;
  filteredPackageResult: FisherInformationResult;
  mantel?: import('./mantel-test.js').MantelTestWithNullModelResult;
}
