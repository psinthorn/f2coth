package models

import "time"

// ---------- Canonical ingest schema (f2.assethub.v1, spec §6.3) ----------
// The collector scripts (agents/collect.sh, collect.ps1) POST this shape.
// Unknown/extra fields are tolerated; the full body is stored raw in JSONB.

const SchemaV1 = "f2.assethub.v1"

type IngestEnvelope struct {
	Schema      string          `json:"schema"`
	CollectedAt string          `json:"collected_at"`
	Collector   IngestCollector `json:"collector"`
	Device      IngestDevice    `json:"device"`
}

type IngestCollector struct {
	Name    string `json:"name"`
	Version string `json:"version"`
}

type IngestDevice struct {
	Hostname              string           `json:"hostname"`
	DeviceType            string           `json:"device_type"`
	Brand                 string           `json:"brand"`
	Model                 string           `json:"model"`
	SerialNumber          string           `json:"serial_number"`
	OS                    IngestOS         `json:"os"`
	CPU                   string           `json:"cpu"`
	RAMMB                 int              `json:"ram_mb"`
	NetworkRole           string           `json:"network_role"`
	DomainOrWorkgroupName string           `json:"domain_or_workgroup_name"`
	Interfaces            []IngestIface    `json:"interfaces"`
	Disks                 []IngestDisk     `json:"disks"`
	Software              []IngestSoftware `json:"software"`
	LoggedInUser          string           `json:"logged_in_user"`
	UptimeHours           float64          `json:"uptime_hours"`
}

type IngestOS struct {
	Name    string `json:"name"`
	Version string `json:"version"`
	Kernel  string `json:"kernel"`
	Arch    string `json:"arch"`
}

type IngestIface struct {
	Name string   `json:"name"`
	MAC  string   `json:"mac"`
	IPv4 []string `json:"ipv4"`
	IPv6 []string `json:"ipv6"`
	Type string   `json:"type"`
	SSID string   `json:"ssid"`
}

type IngestDisk struct {
	Model  string  `json:"model"`
	SizeGB float64 `json:"size_gb"`
	FreeGB float64 `json:"free_gb"`
	Type   string  `json:"type"`
	Smart  string  `json:"smart_status"`
}

type IngestSoftware struct {
	Name    string `json:"name"`
	Version string `json:"version"`
	Vendor  string `json:"vendor"`
}

// ---------- Discovery schema (probe → /api/assethub/discovery) ----------

type DiscoveryEnvelope struct {
	Schema    string             `json:"schema"`
	StartedAt string             `json:"started_at"`
	Collector IngestCollector    `json:"collector"`
	Findings  []DiscoveryFinding `json:"findings"`
}

type DiscoveryFinding struct {
	IP           string `json:"ip"`
	MAC          string `json:"mac"`
	Vendor       string `json:"vendor"`
	Hostname     string `json:"hostname"`
	OpenPorts    string `json:"open_ports"`
	SNMPSysDescr string `json:"snmp_sysdescr"`
	SerialNumber string `json:"serial_number"`
	// The probe emits guessed_type; accept suggested_type too for forward-compat.
	SuggestedType string `json:"suggested_type"`
	GuessedType   string `json:"guessed_type"`
}

// Type returns the classification the probe assigned, preferring the newer
// suggested_type field and falling back to the probe's guessed_type.
func (f DiscoveryFinding) Type() string {
	if f.SuggestedType != "" {
		return f.SuggestedType
	}
	return f.GuessedType
}

// ---------- DB row / API response structs ----------

type Site struct {
	ID         string    `json:"id"`
	CustomerID string    `json:"customer_id"`
	Name       string    `json:"name"`
	CIDRs      []string  `json:"cidrs"`
	Notes      *string   `json:"notes"`
	CreatedAt  time.Time `json:"created_at"`
	UpdatedAt  time.Time `json:"updated_at"`
}

type Token struct {
	ID          string     `json:"id"`
	CustomerID  string     `json:"customer_id"`
	SiteID      *string    `json:"site_id"`
	Label       string     `json:"label"`
	TokenPrefix string     `json:"token_prefix"`
	LastUsedAt  *time.Time `json:"last_used_at"`
	RevokedAt   *time.Time `json:"revoked_at"`
	CreatedAt   time.Time  `json:"created_at"`
	// Secret is only populated once, in the create response.
	Secret string `json:"secret,omitempty"`
}

type Device struct {
	ID                    string     `json:"id"`
	CustomerID            string     `json:"customer_id"`
	SiteID                *string    `json:"site_id"`
	SiteName              *string    `json:"site_name,omitempty"`
	DeviceType            string     `json:"device_type"`
	Hostname              *string    `json:"hostname"`
	Brand                 *string    `json:"brand"`
	Model                 *string    `json:"model"`
	SerialNumber          *string    `json:"serial_number"`
	AssetTag              *string    `json:"asset_tag"`
	OSName                *string    `json:"os_name"`
	OSVersion             *string    `json:"os_version"`
	CPU                   *string    `json:"cpu"`
	RAMMB                 *int       `json:"ram_mb"`
	StorageSummary        *string    `json:"storage_summary"`
	NetworkRole           string     `json:"network_role"`
	DomainOrWorkgroupName *string    `json:"domain_or_workgroup_name"`
	PrimaryMAC            *string    `json:"primary_mac"`
	PrimaryIP             *string    `json:"primary_ip"`
	AssignedUser          *string    `json:"assigned_user"`
	Status                string     `json:"status"`
	Source                string     `json:"source"`
	FirstSeen             time.Time  `json:"first_seen"`
	LastSeen              time.Time  `json:"last_seen"`
	Notes                 *string    `json:"notes"`
	CreatedAt             time.Time  `json:"created_at"`
	UpdatedAt             time.Time  `json:"updated_at"`
	Interfaces            []Iface    `json:"interfaces,omitempty"`
	Disks                 []Disk     `json:"disks,omitempty"`
	Software              []Software `json:"software,omitempty"`
}

type Iface struct {
	Name *string  `json:"name"`
	MAC  *string  `json:"mac"`
	IPv4 []string `json:"ipv4"`
	IPv6 []string `json:"ipv6"`
	Type *string  `json:"type"`
	SSID *string  `json:"ssid"`
}

type Disk struct {
	Model  *string  `json:"model"`
	SizeGB *float64 `json:"size_gb"`
	FreeGB *float64 `json:"free_gb"`
	Type   *string  `json:"type"`
	Smart  *string  `json:"smart_status"`
}

type Software struct {
	Name    string  `json:"name"`
	Version *string `json:"version"`
	Vendor  *string `json:"vendor"`
}

type Finding struct {
	ID            string    `json:"id"`
	RunID         string    `json:"run_id"`
	SiteID        *string   `json:"site_id"`
	IP            *string   `json:"ip"`
	MAC           *string   `json:"mac"`
	Vendor        *string   `json:"vendor"`
	Hostname      *string   `json:"hostname"`
	OpenPorts     *string   `json:"open_ports"`
	SNMPSysDescr  *string   `json:"snmp_sysdescr"`
	SuggestedType string    `json:"suggested_type"`
	Status        string    `json:"status"`
	DeviceID      *string   `json:"device_id"`
	CreatedAt     time.Time `json:"created_at"`
}

type ReportJob struct {
	ID         string    `json:"id"`
	CustomerID string    `json:"customer_id"`
	SiteID     *string   `json:"site_id"`
	Format     string    `json:"format"`
	Status     string    `json:"status"`
	Attempts   int       `json:"attempts"`
	FilePath   *string   `json:"file_path"`
	Error      *string   `json:"error"`
	CreatedAt  time.Time `json:"created_at"`
	UpdatedAt  time.Time `json:"updated_at"`
}
