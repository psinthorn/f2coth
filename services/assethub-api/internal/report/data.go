package report

import (
	"context"
	"time"
)

// HandoverData is the fully-resolved payload for a handover document. Shared
// by the xlsx renderer and the docgen (pdf/docx) template.
type HandoverData struct {
	CustomerName string        `json:"customer_name"`
	SiteName     string        `json:"site_name"`
	GeneratedAt  string        `json:"generated_at"`
	Summary      HandoverStats `json:"summary"`
	Network      []NetRow      `json:"network"`   // routers/switches/aps/printers/nas/cameras
	Computers    []CompRow     `json:"computers"` // computer/server/phone/tablet
}

type HandoverStats struct {
	Total      int            `json:"total"`
	Network    int            `json:"network"`
	Computers  int            `json:"computers"`
	ByType     map[string]int `json:"by_type"`
	Domain     int            `json:"domain"`
	Workgroup  int            `json:"workgroup"`
	Standalone int            `json:"standalone"`
}

type NetRow struct {
	Type     string `json:"type"`
	Hostname string `json:"hostname"`
	Brand    string `json:"brand"`
	Model    string `json:"model"`
	IP       string `json:"ip"`
	MAC      string `json:"mac"`
}

type CompRow struct {
	Hostname        string `json:"hostname"`
	Type            string `json:"type"`
	Brand           string `json:"brand"`
	Model           string `json:"model"`
	Serial          string `json:"serial"`
	CPU             string `json:"cpu"`
	RAMMB           int    `json:"ram_mb"`
	Storage         string `json:"storage"`
	OS              string `json:"os"`
	NetworkRole     string `json:"network_role"`
	DomainWorkgroup string `json:"domain_workgroup"`
	Software        []SW   `json:"software"`
}

type SW struct {
	Name    string `json:"name"`
	Version string `json:"version"`
	Vendor  string `json:"vendor"`
}

var networkTypes = map[string]bool{
	"router": true, "switch": true, "ap": true, "printer": true,
	"nas": true, "camera": true, "iot": true,
}

// gather assembles the full handover dataset for a customer (optionally one
// site) from the register tables.
func (wk *Worker) gather(ctx context.Context, customerID string, siteID *string) (*HandoverData, error) {
	d := &HandoverData{
		GeneratedAt: time.Now().Format("2006-01-02 15:04"),
		Summary:     HandoverStats{ByType: map[string]int{}},
	}
	_ = wk.DB.QueryRow(ctx, `SELECT name FROM customers WHERE id=$1`, customerID).Scan(&d.CustomerName)
	if siteID != nil {
		_ = wk.DB.QueryRow(ctx, `SELECT name FROM assethub_sites WHERE id=$1`, *siteID).Scan(&d.SiteName)
	}

	args := []any{customerID}
	filter := "customer_id=$1"
	if siteID != nil {
		args = append(args, *siteID)
		filter += " AND site_id=$2"
	}

	rows, err := wk.DB.Query(ctx, `
		SELECT id, device_type, COALESCE(hostname,''), COALESCE(brand,''), COALESCE(model,''),
		       COALESCE(serial_number,''), COALESCE(cpu,''), COALESCE(ram_mb,0), COALESCE(storage_summary,''),
		       TRIM(COALESCE(os_name,'')||' '||COALESCE(os_version,'')), network_role,
		       COALESCE(domain_or_workgroup_name,''), COALESCE(primary_ip,''), COALESCE(primary_mac,'')
		FROM assethub_devices WHERE `+filter+` ORDER BY device_type, hostname`, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	type devrow struct {
		id, dtype, host, brand, model, serial, cpu, storage, os, netrole, domwg, ip, mac string
		ram                                                                              int
	}
	var devs []devrow
	for rows.Next() {
		var r devrow
		if err := rows.Scan(&r.id, &r.dtype, &r.host, &r.brand, &r.model, &r.serial, &r.cpu, &r.ram,
			&r.storage, &r.os, &r.netrole, &r.domwg, &r.ip, &r.mac); err != nil {
			return nil, err
		}
		devs = append(devs, r)
	}
	rows.Close()

	for _, r := range devs {
		d.Summary.Total++
		d.Summary.ByType[r.dtype]++
		switch r.netrole {
		case "domain":
			d.Summary.Domain++
		case "workgroup":
			d.Summary.Workgroup++
		case "standalone":
			d.Summary.Standalone++
		}
		if networkTypes[r.dtype] {
			d.Summary.Network++
			d.Network = append(d.Network, NetRow{
				Type: r.dtype, Hostname: r.host, Brand: r.brand, Model: r.model, IP: r.ip, MAC: r.mac,
			})
			continue
		}
		d.Summary.Computers++
		comp := CompRow{
			Hostname: r.host, Type: r.dtype, Brand: r.brand, Model: r.model, Serial: r.serial,
			CPU: r.cpu, RAMMB: r.ram, Storage: r.storage, OS: r.os, NetworkRole: r.netrole,
			DomainWorkgroup: r.domwg,
		}
		swRows, err := wk.DB.Query(ctx, `SELECT name, COALESCE(version,''), COALESCE(vendor,'') FROM assethub_device_software WHERE device_id=$1 ORDER BY name`, r.id)
		if err == nil {
			for swRows.Next() {
				var s SW
				if err := swRows.Scan(&s.Name, &s.Version, &s.Vendor); err == nil {
					comp.Software = append(comp.Software, s)
				}
			}
			swRows.Close()
		}
		d.Computers = append(d.Computers, comp)
	}
	return d, nil
}
