import { useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { API_URL } from '../config'
import { authFetch } from '../api/authFetch'

import {
  createUserWithEmailAndPassword,
  updateProfile
} from 'firebase/auth'

import { auth } from '../firebase/auth'
import { useI18n } from '../i18n/I18nContext'
import { formText, serverFieldError } from '../i18n/formText'
import FormField from '../components/forms/FormField'
import { INPUT_CLASS, inputBorder } from '../components/forms/inputStyles'
import PhoneInput from '../components/forms/PhoneInput'
import EmailInput from '../components/forms/EmailInput'
import PostalCodeInput from '../components/forms/PostalCodeInput'
import { focusFirstInvalid } from '../components/forms/focusFirstInvalid'
import {
  callingCodeOf, emailProblem, nameProblem, normalizeEmail, phoneProblem, postalCodeProblem, regionOfPhone
} from '../utils/validators'

const SERVER_FIELDS = { name: 'name', phone: 'phone', postal_code: 'zipCode', email: 'email' }

function Register() {

  const navigate = useNavigate()
  const { language } = useI18n()
  const text = (key, values) => formText(language, key, values)
  const formRef = useRef(null)

  const [name, setName] = useState('')
  const [phone, setPhone] = useState('') // E.164, Spain (+34) by default
  const [city, setCity] = useState('')
  const [address, setAddress] = useState('')
  const [zipCode, setZipCode] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [errors, setErrors] = useState({})
  const [formError, setFormError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const country = regionOfPhone(phone) || 'ES'

  const validate = () => {
    const found = {}
    const codes = {
      name: nameProblem(name),
      phone: phoneProblem(phone),
      zipCode: postalCodeProblem(zipCode, country, { required: false }),
      email: emailProblem(email),
      password: password.length >= 6 ? null : (password ? 'password_short' : 'required'),
    }
    for (const [key, code] of Object.entries(codes)) if (code) found[key] = text(code)
    return found
  }

  const handleRegister = async (e) => {

    e.preventDefault()
    if (submitting) return

    const found = validate()
    setErrors(found)
    setFormError('')
    if (Object.keys(found).length) {
      focusFirstInvalid(formRef.current)
      return
    }

    setSubmitting(true)

    try {

      const result =
        await createUserWithEmailAndPassword(
          auth,
          normalizeEmail(email),
          password
        )

      const user = result.user

      await updateProfile(
        user,
        {
          displayName: name.trim()
        }
      )

      const response = await authFetch(
        `${API_URL}/users`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            firebase_uid: user.uid,
            nome: name.trim(),
            email: normalizeEmail(email),
            foto: null,
            telefone: phone,                 // E.164
            codigo_pais: callingCodeOf(phone),
            cidade: city.trim(),
            morada: address.trim(),
            cep: zipCode.trim()
          })
        }
      )

      if (response.status === 422) {
        const data = await response.json().catch(() => ({}))
        const fieldError = serverFieldError(data.detail, language)
        if (fieldError && SERVER_FIELDS[fieldError.field]) {
          setErrors({ [SERVER_FIELDS[fieldError.field]]: fieldError.message })
          focusFirstInvalid(formRef.current)
          return
        }
        setFormError(fieldError?.message || text('server_error'))
        return
      }

      alert('Account created successfully!')

      navigate('/dashboard')

    } catch (error) {

      console.log(error)

      setFormError(error.message)

    } finally {

      setSubmitting(false)

    }

  }

  const textField = (key, label, value, setValue, options = {}) => (
    <FormField label={label} required={options.required} error={errors[key]}>
      {({ id, describedBy, invalid }) => (
        <input
          id={id}
          type={options.type || 'text'}
          autoComplete={options.autoComplete}
          maxLength={options.maxLength}
          value={value}
          onChange={(e) => { setValue(e.target.value); if (errors[key]) setErrors(current => ({ ...current, [key]: undefined })) }}
          onBlur={options.onBlur}
          aria-invalid={invalid || undefined}
          aria-required={options.required || undefined}
          aria-describedby={describedBy}
          className={`${INPUT_CLASS} ${inputBorder(invalid)}`}
        />
      )}
    </FormField>
  )

  const clear = (key) => { if (errors[key]) setErrors(current => ({ ...current, [key]: undefined })) }

  return (
    <div className="min-h-screen bg-black text-white flex items-center justify-center px-6 py-10">

      <div className="w-full max-w-lg border border-white/10 p-6 sm:p-10 rounded-2xl">

        <h1
          style={{ fontFamily: 'Bebas Neue' }}
          className="text-5xl mb-10 text-center"
        >
          Register
        </h1>

        <form
          ref={formRef}
          onSubmit={handleRegister}
          noValidate
          className="flex flex-col gap-1"
        >

          {textField('name', text('label_name'), name, setName, {
            required: true, autoComplete: 'name', maxLength: 120,
            onBlur: () => { const code = nameProblem(name); setErrors(current => ({ ...current, name: code ? text(code) : undefined })) }
          })}

          <PhoneInput
            label={text('label_phone')} required language={language} value={phone}
            error={errors.phone} onChange={(value) => { setPhone(value); clear('phone') }}
          />

          {textField('city', text('label_city'), city, setCity, { autoComplete: 'address-level2', maxLength: 80 })}

          {textField('address', text('label_address'), address, setAddress, { autoComplete: 'street-address', maxLength: 200 })}

          <PostalCodeInput
            label={text('label_postal_code')} language={language} country={country} value={zipCode}
            error={errors.zipCode} onChange={(value) => { setZipCode(value); clear('zipCode') }}
          />

          <EmailInput
            label={text('label_email')} required language={language} value={email}
            error={errors.email} onChange={(value) => { setEmail(value); clear('email') }}
          />

          {textField('password', text('label_password'), password, setPassword, { required: true, type: 'password', autoComplete: 'new-password' })}

          {formError && (
            <p role="alert" className="mb-2 rounded-xl border border-red-400/25 bg-red-400/10 px-4 py-3 text-sm text-red-200">{formError}</p>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="mt-3 inline-flex items-center justify-center gap-3 bg-white text-black py-4 uppercase tracking-[3px] rounded-lg hover:bg-gray-300 transition duration-300 disabled:cursor-wait disabled:opacity-60"
          >
            {submitting && <span aria-hidden="true" className="h-4 w-4 animate-spin rounded-full border-2 border-black/30 border-t-black" />}
            Create Account
          </button>

          <p className="text-center text-gray-400 text-sm mt-2">

            Already have an account?{' '}

            <Link
              to="/login"
              className="inline-block py-2 text-white hover:text-gray-300"
            >
              Login
            </Link>

          </p>

        </form>

      </div>

    </div>
  )
}

export default Register
