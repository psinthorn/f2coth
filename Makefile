# Start applicaton by run command below you can use start or run 
# use start to skip test 
start:
	go build -o go_smallsite app/*.go && ./go_smallsite

run:
	go run app/*.go