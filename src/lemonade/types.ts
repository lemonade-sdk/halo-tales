export type EndpointSource = 'system' | 'embedded';

export interface LemonadeEndpoint {
  base_url: string;
  api_key: string | null;
  source: EndpointSource;
}

export interface LemonadeModel {
  id: string;
  labels?: string[];
  installed?: boolean;
}

export type LifecycleStage =
  | 'probing'
  | 'downloading_lemonade'
  | 'starting_lemonade'
  | 'checking_models'
  | 'pulling_model'
  | 'ready'
  | 'error';

export interface LifecycleState {
  stage: LifecycleStage;
  message?: string;
  endpoint?: LemonadeEndpoint;
  /** percent 0-100 for the current step, or undefined for indeterminate */
  progress?: number;
  progressDetails?: ProgressDetails;
  /** model id currently being pulled (if any) */
  pulling?: string;
  error?: string;
}

export interface ProgressDetails {
  downloaded?: number;
  total?: number;
  rate?: number;
}

export interface DownloadProgress {
  stage: 'download' | 'extract' | 'done';
  bytes: number;
  total: number;
  bytes_per_second?: number;
  message: string;
}
