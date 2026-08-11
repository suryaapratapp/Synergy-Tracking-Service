export type UserRole = 'admin' | 'synergy' | 'synergy_field' | 'hospital'

export const ROLE_LABELS: Record<UserRole, string> = {
  admin: 'Administrator',
  synergy: 'Synergy',
  synergy_field: 'Synergy field',
  hospital: 'Hospital',
}

export const ROLE_HELP: Record<UserRole, string> = {
  admin: 'Full access, including QR labels and user management',
  synergy: 'All sites and all products, including reports',
  synergy_field: 'All sites for install and take-down work, without reports',
  hospital: 'One hospital only — its own products and installations',
}
export type ItemStatus = 'registered' | 'in_use' | 'removed' | 'retired'
export type RemovalReason = 'expired' | 'soiled' | 'damage'

export interface Profile {
  id: string
  email: string | null
  username: string | null
  full_name: string | null
  role: UserRole
  hospital_id: string | null
  active: boolean
  created_at: string
}

export interface Hospital {
  id: string
  name: string
  code: string | null
  address: string | null
  active: boolean
}

export interface LocationRow {
  hospital_id: string
  hospital_name: string
  hospital_code: string | null
  ward_id: string
  ward_name: string
  floor: string
  bay_id: string
  bay_name: string
  active: boolean
  active_products: number
}

export interface ProductView {
  id: string
  qr_code: string
  product_type: string
  size: string | null
  colour: string | null
  batch: string | null
  status: ItemStatus
  notes: string | null
  registered_at: string
  registered_by: string | null
  registered_by_name: string | null
  installation_id: string | null
  installed_at: string | null
  due_date: string | null
  installed_by: string | null
  installed_by_name: string | null
  hospital_id: string | null
  hospital_name: string | null
  ward_id: string | null
  ward_name: string | null
  floor: string | null
  bay_id: string | null
  bay_name: string | null
  days_remaining: number | null
  is_overdue: boolean
}

export interface InstallationView {
  id: string
  product_id: string
  qr_code: string
  product_type: string
  hospital_id: string
  hospital_name: string
  ward_id: string
  ward_name: string
  floor: string
  bay_id: string
  bay_name: string
  installed_at: string
  installed_by: string | null
  installed_by_name: string | null
  due_date: string
  removed_at: string | null
  removed_by: string | null
  removed_by_name: string | null
  removal_reason: RemovalReason | null
  removal_notes: string | null
  state: 'active' | 'ended'
  days_in_service: number
}

export interface ProductEvent {
  id: number
  product_id: string | null
  installation_id: string | null
  hospital_id: string | null
  event_type: string
  actor_id: string | null
  detail: Record<string, unknown>
  created_at: string
}

export interface DashboardData {
  scope_hospital_id: string | null
  generated_at: string
  totals: {
    products: number
    in_use: number
    in_stock: number
    removed: number
    retired: number
    overdue: number
    due_7: number
    due_14: number
    due_30: number
    hospitals: number
    installed_30: number
    removed_30: number
    avg_service_days: number | null
  }
  by_hospital: { hospital_id: string; name: string; in_use: number; overdue: number; due_7: number }[]
  by_ward: { ward_id: string; name: string; floor: string; hospital: string; in_use: number; overdue: number }[]
  by_reason: { reason: RemovalReason; count: number }[]
  by_status: { status: ItemStatus; count: number }[]
  trend: { month: string; label: string; installed: number; removed: number }[]
  due_soon: {
    installation_id: string
    product_id: string
    qr_code: string
    due_date: string
    days: number
    hospital: string
    ward: string
    floor: string
    bay: string
  }[]
  recent: {
    id: number
    type: string
    at: string
    qr_code: string | null
    actor: string | null
    hospital: string | null
    detail: Record<string, unknown>
  }[]
}

export const REMOVAL_REASONS: { value: RemovalReason; label: string; help: string }[] = [
  { value: 'expired', label: 'Expired', help: 'Reached scheduled change-due date' },
  { value: 'soiled', label: 'Soiled', help: 'Removed early due to soiling / contamination' },
  { value: 'damage', label: 'Damage', help: 'Removed early due to damage' },
]

export const STATUS_LABELS: Record<ItemStatus, string> = {
  registered: 'In stock',
  in_use: 'In use',
  removed: 'Taken down',
  retired: 'Retired',
}
