package domain

var CategoryService contentsDomainInterface = &Category{}

type Category category
type contentsDomainInterface interface {
	Create() (int, error)
}

func (c *Category) Create() (int, error) {
	return 0, nil
}
