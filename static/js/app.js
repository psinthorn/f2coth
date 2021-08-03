// Sweetalert promp for notifications 
function Prompt() {
    let toast = function (c) {
        const{
            msg = '',
            icon = 'success',
            position = 'top-end',

        } = c;

        const Toast = Swal.mixin({
            toast: true,
            title: msg,
            position: position,
            icon: icon,
            showConfirmButton: false,
            timer: 3000,
            timerProgressBar: true,
            didOpen: (toast) => {
                toast.addEventListener('mouseenter', Swal.stopTimer)
                toast.addEventListener('mouseleave', Swal.resumeTimer)
            }
        })

        Toast.fire({})
    }

    let success = function (c) {
        const {
            msg = "",
            title = "",
            footer = "",
        } = c

        Swal.fire({
            icon: 'success',
            title: title,
            text: msg,
            footer: footer,
        })

    }

    let error = function (c) {
        const {
            msg = "",
            title = "",
            footer = "",
        } = c

        Swal.fire({
            icon: 'error',
            title: title,
            text: msg,
            footer: footer,
        })

    }

    async function custom(c) {
        const {
            icon = "",
            msg = "",
            title = "",
            showConfirmButton = true,
            showCloseButton = true,
            showCancelButton =  true,
            cancelButtonText = "Cancel",
        } = c;

        const { value: results } = await Swal.fire({
            icon: icon,
            title: title,
            html: msg,
            backdrop: true,
            focusConfirm: false,
            showCloseButton: showCloseButton,
            showConfirmButton: showConfirmButton,
            showCancelButton: showCancelButton,
            cancelButtonText: cancelButtonText,

            willOpen: () => {
               if(c.willOpen !== undefined){
                  c.willOpen();
               }
            },
            didOpen: () => {
                if(c.didOpen !== undefined){
                    c.didOpen();
                }
            },
            preConfirm: () => {
                return [
                    document.getElementById('start_date').value,
                    document.getElementById('end_date').value
                ]
            }
        })

        if (results) {
           if(results.dismiss !== Swal.DismissReason.cancel) {
              if(results.value !== ""){
                  if(c.callback !== undefined){
                      c.callback(results);
                  }
              }else {
                  c.callback(false);
              }
           } else {
              c.callback(false);
           }
      }
    }


    return {
        toast: toast,
        success: success,
        error: error,
        custom: custom,
    }
}