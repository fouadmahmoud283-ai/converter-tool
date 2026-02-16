/**
 * Additional utility types for the converter
 */

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH' | 'OPTIONS' | 'HEAD';

export interface RouteConfig {
  name: string;
  path: string;
  methods: HttpMethod[];
  handlerPath: string;
}

export interface ConversionReport {
  timestamp: string;
  sourceRepo: string;
  functionsConverted: number;
  dependencies: string[];
  envVariables: string[];
  warnings: string[];
  errors: string[];
}

export interface AnalysisResult {
  functions: FunctionAnalysis[];
  sharedCode: SharedCodeAnalysis[];
  totalFiles: number;
  totalDependencies: number;
  totalEnvVars: number;
}

export interface FunctionAnalysis {
  name: string;
  entryPoint: string;
  files: FileAnalysis[];
  dependencies: string[];
  envVars: string[];
  usesShared: boolean;
  complexity: 'simple' | 'moderate' | 'complex';
}

export interface FileAnalysis {
  path: string;
  size: number;
  imports: string[];
  exports: string[];
  hasServe: boolean;
  hasDenoEnv: boolean;
}

export interface SharedCodeAnalysis {
  name: string;
  files: string[];
  usedBy: string[];
}
