package domain_mail

type MailDataTemplate struct {
	To       string `json: "to"`
	From     string `json: "from"`
	Subject  string `json: "subject"`
	Content  string `json: "content"`
	Template string `json: "template"`
}
