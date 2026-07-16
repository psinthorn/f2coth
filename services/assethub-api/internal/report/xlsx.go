package report

import (
	"github.com/xuri/excelize/v2"
)

// renderXLSX writes the handover workbook (spec §9): a summary sheet, a
// network-equipment register, a computer register, and a per-device software
// appendix. One sheet per section.
func renderXLSX(path string, d *HandoverData) error {
	f := excelize.NewFile()
	defer f.Close()

	// --- Summary ---
	const summary = "Summary"
	f.SetSheetName("Sheet1", summary)
	title := d.CustomerName + " — IT Asset Handover"
	if d.SiteName != "" {
		title += " (" + d.SiteName + ")"
	}
	writeRow(f, summary, 1, []any{title})
	writeRow(f, summary, 2, []any{"Generated", d.GeneratedAt})
	writeRow(f, summary, 3, []any{"Prepared by", "F2 Co., Ltd. — f2.co.th"})
	writeRow(f, summary, 5, []any{"Total assets", d.Summary.Total})
	writeRow(f, summary, 6, []any{"Network equipment", d.Summary.Network})
	writeRow(f, summary, 7, []any{"Computers & devices", d.Summary.Computers})
	writeRow(f, summary, 8, []any{"Domain-joined", d.Summary.Domain})
	writeRow(f, summary, 9, []any{"Workgroup", d.Summary.Workgroup})
	writeRow(f, summary, 10, []any{"Standalone", d.Summary.Standalone})
	r := 12
	writeRow(f, summary, r, []any{"By type"})
	r++
	for t, n := range d.Summary.ByType {
		writeRow(f, summary, r, []any{t, n})
		r++
	}

	// --- Network register ---
	const net = "Network"
	f.NewSheet(net)
	writeRow(f, net, 1, []any{"Type", "Hostname", "Brand", "Model", "IP", "MAC"})
	for i, n := range d.Network {
		writeRow(f, net, i+2, []any{n.Type, n.Hostname, n.Brand, n.Model, n.IP, n.MAC})
	}

	// --- Computer register ---
	const comp = "Computers"
	f.NewSheet(comp)
	writeRow(f, comp, 1, []any{"Hostname", "Type", "Brand", "Model", "Serial", "CPU", "RAM (MB)", "Storage", "OS", "Network role", "Domain/Workgroup"})
	for i, c := range d.Computers {
		writeRow(f, comp, i+2, []any{c.Hostname, c.Type, c.Brand, c.Model, c.Serial, c.CPU, c.RAMMB, c.Storage, c.OS, c.NetworkRole, c.DomainWorkgroup})
	}

	// --- Software appendix ---
	const sw = "Software"
	f.NewSheet(sw)
	writeRow(f, sw, 1, []any{"Device", "Software", "Version", "Vendor"})
	row := 2
	for _, c := range d.Computers {
		for _, s := range c.Software {
			writeRow(f, sw, row, []any{c.Hostname, s.Name, s.Version, s.Vendor})
			row++
		}
	}

	f.SetActiveSheet(0)
	return f.SaveAs(path)
}

func writeRow(f *excelize.File, sheet string, row int, vals []any) {
	for i, v := range vals {
		cell, _ := excelize.CoordinatesToCellName(i+1, row)
		_ = f.SetCellValue(sheet, cell, v)
	}
}
