
document.getElementById("check-availability-button").addEventListener("click", function () {
    let html = `
    <form id="check-availability-form" action="/rooms/search-availability-response" method="post" novalidate class="needs-validation">
        <div class="form-row">
          <input type="hidden" value="1" id="room_id" name="room_id">
          <div class="col">
                <div class="form-row" id="reservation-dates-modal">
                    <div class="col">
                        <input disabled required class="form-control" type="text" name="start_date" id="start_date" placeholder="Arrival" autocomplete="off">
                    </div>
                    <div class="col">
                        <input disabled required class="form-control" type="text" name="end_date" id="end_date" placeholder="Departure" autocomplete="off">
                    </div>
                </div>
            </div>
        </div>
    </form>
    `;
    attention.custom({
      title: 'Choose your dates',
      msg: html,

      willOpen: () => {
                const elem = document.getElementById("reservation-dates-modal");
                const rp = new DateRangePicker(elem, {
                    format: 'yyyy-mm-dd',
                    showOnFocus: true,
                    minDate: new Date(),
                })
      },

      didOpen: () => {
                document.getElementById("start_date").removeAttribute("disabled");
                document.getElementById("end_date").removeAttribute("disabled");
      },

        callback: (results) => {
          let form = document.getElementById("check-availability-form");

          // retrive data from all form input field
          let formData = new FormData(form);

          // append csrf to form
          formData.append("csrf_token", "{{.CSRFToken}}");

          fetch("/rooms/search-availability-response", {
              method: 'post',
              body: formData,
          })
          .then(response => response.json())
          .then(data => {
              if (data.Ok) {
                  attention.custom({
                      icon: "success",
                      showConfirmButton: false,
                      showCloseButton: true,
                      showCancelButton: false,
                      msg: `<p>Room is available</p>`,
                  })
              } else {
                  attention.custom({
                      icon: "warning",
                      showConfirmButton: false,
                      showCloseButton: false,
                      showCancelButton: true,
                      cancelButtonText:
                      'Choose new dates',
                      msg: `<p>Sorry :( Room is not available</p>`,
                  })
              }
          })
        }
    });
})
