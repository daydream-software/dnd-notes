<#import "template.ftl" as layout>
<@layout.registrationLayout displayMessage=!messagesPerField.existsError('totp'); section>
  <#if section = "form">

    <form id="kc-otp-login-form" action="${url.loginAction}" method="post">

      <#if otpLogin.userOtpCredentials?size gt 1>
        <div class="form-group">
          <label for="selectedCredentialId">${msg("loginOtpOneTime")}</label>
          <select id="selectedCredentialId" name="selectedCredentialId">
            <#list otpLogin.userOtpCredentials as otpCredential>
              <option
                value="${otpCredential.id}"
                <#if otpCredential.id == otpLogin.selectedCredentialId>selected</#if>
              >${otpCredential.userLabel}</option>
            </#list>
          </select>
        </div>
      </#if>

      <div class="form-group">
        <label for="otp">${msg("loginOtpOneTime")}</label>
        <input
          id="otp"
          name="otp"
          type="text"
          inputmode="numeric"
          autocomplete="one-time-code"
          autofocus
          class="otp-input"
        >
        <#if messagesPerField.existsError('totp')>
          <div class="alert alert-error">
            ${kcSanitize(messagesPerField.getFirstError('totp'))?no_esc}
          </div>
        </#if>
      </div>

      <div id="kc-form-buttons">
        <button type="submit">${msg("doLogIn")}</button>
      </div>

    </form>

  </#if>
</@layout.registrationLayout>
