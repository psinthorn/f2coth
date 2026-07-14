package models

import "time"

type Service struct {
	ID           string    `json:"id"`
	Slug         string    `json:"slug"`
	Title        string    `json:"title"`
	ShortSummary string    `json:"short_summary"`
	Description  string    `json:"description"`
	Intro        string    `json:"intro"`
	FAQ          []FAQItem `json:"faq"`
	Icon         *string   `json:"icon,omitempty"`
	Category     string    `json:"category"`
	SortOrder    int       `json:"sort_order"`
	IsPublished  bool      `json:"is_published"`
	CreatedAt    time.Time `json:"created_at"`
	UpdatedAt    time.Time `json:"updated_at"`
}

// FAQItem is one Q → A pair, kept small so a service can carry an
// inline array of them without a join table. Fields match schema.org
// Question/Answer casing so the frontend can pass through into the
// FAQPage JSON-LD emitter with minimal transformation.
type FAQItem struct {
	Q string `json:"q"`
	A string `json:"a"`
}

type CaseStudy struct {
	ID                string     `json:"id"`
	Slug              string     `json:"slug"`
	ClientName        string     `json:"client_name"`
	Industry          string     `json:"industry"`
	Location          *string    `json:"location,omitempty"`
	RelationshipYears *int       `json:"relationship_years,omitempty"`
	HeroImageURL      *string    `json:"hero_image_url,omitempty"`
	Summary           string     `json:"summary"`
	Challenge         string     `json:"challenge"`
	Solution          string     `json:"solution"`
	Results           string     `json:"results"`
	QuoteText         *string    `json:"quote_text,omitempty"`
	QuoteAuthor       *string    `json:"quote_author,omitempty"`
	ServicesUsed      []string   `json:"services_used"`
	SortOrder         int        `json:"sort_order"`
	IsPublished       bool       `json:"is_published"`
	PublishedAt       *time.Time `json:"published_at,omitempty"`
	CreatedAt         time.Time  `json:"created_at"`
	UpdatedAt         time.Time  `json:"updated_at"`
}

type BlogPost struct {
	ID            string     `json:"id"`
	Slug          string     `json:"slug"`
	Title         string     `json:"title"`
	Excerpt       string     `json:"excerpt"`
	BodyMD        string     `json:"body_md"`
	CoverImageURL *string    `json:"cover_image_url,omitempty"`
	AuthorID      *string    `json:"author_id,omitempty"`
	AuthorName    string     `json:"author_name"` // joined from users.full_name, defaults to "F2 Editorial Team"
	Tags          []string   `json:"tags"`
	IsPublished   bool       `json:"is_published"`
	PublishedAt   *time.Time `json:"published_at,omitempty"`
	CreatedAt     time.Time  `json:"created_at"`
	UpdatedAt     time.Time  `json:"updated_at"`
}

type Page struct {
	ID             string    `json:"id"`
	Slug           string    `json:"slug"`
	Title          string    `json:"title"`
	BodyMD         string    `json:"body_md"`
	SEOTitle       *string   `json:"seo_title,omitempty"`
	SEODescription *string   `json:"seo_description,omitempty"`
	IsPublished    bool      `json:"is_published"`
	CreatedAt      time.Time `json:"created_at"`
	UpdatedAt      time.Time `json:"updated_at"`
}

type DomainPricing struct {
	ID               string    `json:"id"`
	TLD              string    `json:"tld"`
	Registry         string    `json:"registry"`
	RegisterPriceTHB int       `json:"register_price_thb"`
	RenewPriceTHB    int       `json:"renew_price_thb"`
	TransferPriceTHB int       `json:"transfer_price_thb"`
	PrivacyIncluded  bool      `json:"privacy_included"`
	IsThaiOnly       bool      `json:"is_thai_only"`
	// Grace/redemption recovery for lapsed domains (migration 060).
	GracePeriodDays      int       `json:"grace_period_days"`
	RedemptionPeriodDays int       `json:"redemption_period_days"`
	GraceFeeTHB          int       `json:"grace_fee_thb"`
	RedemptionFeeTHB     int       `json:"redemption_fee_thb"`
	Notes                string    `json:"notes"`
	SortOrder            int       `json:"sort_order"`
	IsActive             bool      `json:"is_active"`
	CreatedAt            time.Time `json:"created_at"`
	UpdatedAt            time.Time `json:"updated_at"`
}

type HostingPlan struct {
	ID               string    `json:"id"`
	Slug             string    `json:"slug"`
	Name             string    `json:"name"`
	Tagline          string    `json:"tagline"`
	PriceTHBMonthly  int       `json:"price_thb_monthly"`
	PriceTHBAnnually int       `json:"price_thb_annually"`
	StorageGB        int       `json:"storage_gb"`
	SitesIncluded    int       `json:"sites_included"`
	EmailsIncluded   int       `json:"emails_included"`
	BandwidthLabel   string    `json:"bandwidth_label"`
	SSLIncluded      bool      `json:"ssl_included"`
	DailyBackups     bool      `json:"daily_backups"`
	Perks            []string  `json:"perks"`
	IsFeatured       bool      `json:"is_featured"`
	SortOrder        int       `json:"sort_order"`
	IsPublished      bool      `json:"is_published"`
	CreatedAt        time.Time `json:"created_at"`
	UpdatedAt        time.Time `json:"updated_at"`
}
