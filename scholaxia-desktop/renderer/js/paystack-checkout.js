/**
 * Paystack checkout — matches mobile PaystackCheckoutService.
 * Opens Paystack in a popup (iframes are often blocked by Paystack).
 */
(function (global) {
  /**
   * @param {{productType:string, productId:string}} opts
   * @returns {Promise<boolean>} true if paid
   */
  async function paystackPurchase(opts) {
    var productType = opts && opts.productType;
    var productId = opts && opts.productId;
    if (!productType || !productId) throw new Error("Missing payment product.");
    if (typeof navigator !== "undefined" && !navigator.onLine) {
      throw new Error("Payment requires internet. Connect and try again.");
    }
    if (typeof api !== "function") throw new Error("API helper not loaded.");

    var body = {
      product_type: productType,
      product_id: String(productId),
    };
    [
      "payment_mode",
      "installment",
      "full_name",
      "phone",
      "email",
      "location",
      "preferred_start",
      "notes",
    ].forEach(function (k) {
      if (opts[k] != null && opts[k] !== "") body[k] = opts[k];
    });

    var guestCbt = !!(opts && opts.guestCbt);
    var initialized = await api(
      guestCbt
        ? "/api/v1/payments/paystack/guest/cbt/initialize"
        : "/api/v1/payments/paystack/initialize",
      {
        method: "POST",
        body: JSON.stringify(body),
      }
    );
    if (initialized && (initialized.already_owned || initialized.already_paid)) return true;
    if (guestCbt && initialized && initialized.guest_token) {
      localStorage.setItem("sia_cbt_guest_token", initialized.guest_token);
    }

    var url = (initialized && initialized.authorization_url) || "";
    var reference = (initialized && initialized.reference) || "";
    if (!url || !reference) throw new Error("Paystack checkout is unavailable.");

    var popup = window.open(url, "scholaxia_paystack", "width=520,height=720");
    var verifyPath = guestCbt
      ? "/api/v1/payments/paystack/guest/cbt/verify"
      : "/api/v1/payments/paystack/verify";
    if (!popup) {
      // Popup blocked — open in same tab with return hint.
      sessionStorage.setItem(
        "sia_paystack_pending",
        JSON.stringify({
          reference: reference,
          productType: productType,
          productId: String(productId),
          guestCbt: guestCbt,
        })
      );
      window.location.href = url;
      return false;
    }

    return await new Promise(function (resolve) {
      var done = false;
      var pollTimer = setInterval(async function () {
        if (done) return;
        try {
          if (popup.closed) {
            // User closed checkout — still verify once.
            clearInterval(pollTimer);
            var closedResult = await api(verifyPath, {
              method: "POST",
              body: JSON.stringify({ reference: reference }),
            });
            done = true;
            resolve(!!(closedResult && (closedResult.paid === true || closedResult.has_access === true)));
            return;
          }
        } catch (e) { /* ignore */ }

        try {
          var result = await api(verifyPath, {
            method: "POST",
            body: JSON.stringify({ reference: reference }),
          });
          if (result && (result.paid === true || result.has_access === true)) {
            done = true;
            clearInterval(pollTimer);
            try { popup.close(); } catch (e2) { /* ignore */ }
            resolve(true);
          }
        } catch (e) { /* waiting */ }
      }, 3000);
    });
  }

  global.paystackPurchase = paystackPurchase;
})(typeof window !== "undefined" ? window : this);
