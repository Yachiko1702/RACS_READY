// Auth helpers (Swal wrappers and validators) - keep small and framework-agnostic
(function () {
  window.authUtils = {
    swalError: function (title, text) {
      return Swal.fire({ icon: 'error', title: title || 'Error', text: text || '', confirmButtonText: 'OK' });
    },

    swalSuccess: function (title, text) {
      return Swal.fire({ icon: 'success', title: title || 'Success', text: text || '', confirmButtonText: 'OK' });
    },

    swalToast: function (icon, title) {
      return Swal.fire({ toast: true, position: 'top-end', showConfirmButton: false, timer: 3000, icon: icon, title: title });
    },

    validateEmail: function (email) {
      if (!email) return false;
      var re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      return re.test(String(email).toLowerCase());
    }
  };


})();