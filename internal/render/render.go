package render

import (
	"bytes"
	"fmt"
	"html/template"
	"log"
	"net/http"
	"path/filepath"
	"time"

	"github.com/justinas/nosurf"
	"github.com/psinthorn/f2coth/configs"
	"github.com/psinthorn/f2coth/domain/templates"
)

var (
	functions = template.FuncMap{
		"humanDate": HumanDate,
	}
	tmplCache = map[string]*template.Template{}
	app       *configs.AppConfig
)

func NewRender(a *configs.AppConfig) {
	app = a
}

func AddDefaultData(td *templates.TemplateData, r *http.Request) *templates.TemplateData {
	td.Flash = app.Session.PopString(r.Context(), "success")
	td.Error = app.Session.PopString(r.Context(), "error")
	td.Warning = app.Session.PopString(r.Context(), "warning")
	td.CSRFToken = nosurf.Token(r)
	if app.Session.Exists(r.Context(), "user_id") {
		td.IsAuthenticate = 1
	}
	return td
}

// Template ช่วยในการ render html template
func Template(w http.ResponseWriter, r *http.Request, tmpl string, td *templates.TemplateData) {

	// หาก UseCache = true ให้อ่าน Template จาก app.AppConfig (ใช้ใน production)
	// หาก UseCache = false ให้อ่าน Template จาก disk ใหม่ทุกครั้ง (สร้าง template ใหม่จากข้อมูลที่มีอยู่ปัจจุบันทุกครั้ง) (ใช้ใน development mode)
	if app.UseCache {
		tmplCache = app.TemplateCache
	} else {
		tmplCache, _ = CreateTemplateCache()
	}

	// ตรวจสอบว่ามี template ตรงที่ต้องการหรือไหม
	newTmpl, ok := tmplCache[tmpl]
	if !ok {
		log.Fatal("Template not found")
	}

	// หากทีให้ทำหารเขียนลงไปที่ bytes buffer
	buff := new(bytes.Buffer)

	// เพิ่มข้อมูลที่ต้องการส่งไปที่ template ทุกครั้งเม่ือ render template
	td = AddDefaultData(td, r)

	// และให้เขียนไปที่ template ใหม่ที่สร้างรอไว้แล้ว (newTmpl)
	_ = newTmpl.Execute(buff, td)

	// และเขียนส่ง buffer new template ให้ response (w)
	_, err := buff.WriteTo(w)
	if err != nil {
		fmt.Println(fmt.Sprintf("error parsing template to browser %s ", err))
	}
}

// CreateTemplateCache ตรวจสอบและสร้าง templateห แบบทั้งหมด
func CreateTemplateCache() (map[string]*template.Template, error) {

	pages, err := filepath.Glob("./templates/*/*.page.html")
	if err != nil {
		fmt.Println(fmt.Sprintf("error on check file path %s", err))
		return nil, err
	}

	for _, page := range pages {

		pageName := filepath.Base(page)

		tmplSet, err := template.New(pageName).Funcs(functions).ParseFiles(page)
		if err != nil {
			fmt.Println(fmt.Sprintf("error can't create new template set error: %s ", err))
			return nil, err
		}

		// ตรวจสอบว่ามีไฟล์ที่ลงท้ายด้วยนามสกุล .layout.html หรือไม่หาก
		matches, err := filepath.Glob("./templates/*/*.layout.html")
		if err != nil {
			fmt.Println(fmt.Sprintf("error can't find any layout file in templates folder error: %s ", err))
			return nil, err
		}

		if len(matches) > 0 {
			tmplSet, err = tmplSet.ParseGlob("./templates/*/*.layout.html")
			if err != nil {
				fmt.Println(fmt.Sprintf("error can't parse layout file to templates set error: %s ", err))
				return nil, err
			}
		}

		tmplCache[pageName] = tmplSet
	}

	return tmplCache, nil
}

// CreateSingleTemplateCache ตรวจสอบและสร้าง template ตาม args ที่ส่งเข้ามาเท่านั้น
func CreateSingleTemplateCache(tmpl string) (map[string]*template.Template, error) {

	// หาไฟล์ชื่อที่ตรงกับ args ที่ส่งเข้ามา หากไม่ไมีมห้คืนค่า err กลับไป
	page, err := filepath.Glob("./templates/" + tmpl)
	if err != nil {
		return nil, err
	}

	// หากมีไฟล์ชื่อตรงกันให้ทำการเตรียมสร้าง template ขึ้นมาใหม่โดยใช้ชื่อตาม args ที่ส่งเข้ามา (tmpl)
	if len(page) > 0 {
		fmt.Println("tmpl name: ", tmpl)
		fmt.Println("page name: ", tmpl)
		fmt.Println("------------------------")

		pageURL := "./templates/" + tmpl

		// สร้าง template ขึ้นมาใหม่โดยใช้ชื่อตาม args ที่ส่งเข้ามา (tmpl) และ 	URL ของตำแหน่งไฟล์ในโปรเจคให้ถูกต้อง
		newTmpl, err := template.New(tmpl).Funcs(functions).ParseFiles(pageURL)
		if err != nil {
			return nil, err
		}

		// ตรวจสอบว่ามีไฟล์ที่ลงท้ายด้วยนามสกุล .layout.html หรือไม่หาก
		matches, err := filepath.Glob("./templates/*/*.layout.html")
		if err != nil {
			fmt.Println(fmt.Sprintf("error can't find any layout file in templates folder error: %s ", err))
			return nil, err
		}

		// หากพบ layout.html มากกว่า 0 ให้ทำการเขียนข้อมูลที่มีในไฟล์ไปที่ newTmpl
		if len(matches) > 0 {
			newTmpl, err = newTmpl.ParseGlob("./templates/*/*.layout.html")
			if err != nil {
				fmt.Println(fmt.Sprintf("error can't parse layout file to templates set error: %s ", err))
				return nil, err
			}

			// เก็บ newTmpl ใน templCache[] อาเรย์
			tmplCache[tmpl] = newTmpl

		}

	} // endif

	// คืนค่า tmplCahe ให้ฟังซ์ชั่น
	return tmplCache, nil
}

// Humandate is return time format as YYYY-MM-DD
func HumanDate(t time.Time) string {
	return t.Format("2006-01-02")
}
