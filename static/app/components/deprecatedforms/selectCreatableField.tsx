import styled from '@emotion/styled';

import {Select} from 'sentry/components/core/select';
import {StyledForm} from 'sentry/components/deprecatedforms/form';
import {SelectField} from 'sentry/components/deprecatedforms/selectField';
import withFormContext from 'sentry/components/deprecatedforms/withFormContext';
import type {SelectValue} from 'sentry/types/core';
import {defined} from 'sentry/utils';
import convertFromSelect2Choices from 'sentry/utils/convertFromSelect2Choices';

// XXX: This is ONLY used in GenericField. If we can delete that this can go.

/**
 * @deprecated Do not use this
 *
 * This is a <SelectField> that allows the user to create new options if one does't exist.
 *
 * This is used in some integrations
 */
class SelectCreatableField extends SelectField {
  options: Array<SelectValue<any>> | undefined;

  constructor(props: SelectCreatableField['props']) {
    super(props);

    // We only want to parse options once because react-select relies
    // on `options` mutation when you create a new option
    //
    // Otherwise you will not get the created option in the dropdown menu
    this.options = this.getOptions(props);
  }

  UNSAFE_componentWillReceiveProps(nextProps: SelectCreatableField['props']) {
    const newError = this.getError(nextProps);
    if (newError !== this.state.error) {
      this.setState({error: newError});
    }
    if (this.props.value !== nextProps.value || defined(nextProps.formContext.form)) {
      const newValue = this.getValue(nextProps);
      // This is the only thing that is different from parent, we compare newValue against coerced value in state
      // To remain compatible with react-select, we need to store the option object that
      // includes `value` and `label`, but when we submit the format, we need to coerce it
      // to just return `value`. Also when field changes, it propagates the coerced value up
      const coercedValue = this.coerceValue(this.state.value);

      // newValue can be empty string because of `getValue`, while coerceValue needs to return null (to differentiate
      // empty string from cleared item). We could use `!=` to compare, but lets be a bit more explicit with strict equality
      //
      // This can happen when this is apart of a field, and it re-renders onChange for a different field,
      // there will be a mismatch between this component's state.value and `this.getValue` result above
      if (
        newValue !== coercedValue &&
        !!newValue !== !!coercedValue &&
        newValue !== this.state.value
      ) {
        this.setValue(newValue);
      }
    }
  }

  getOptions(props: any) {
    return convertFromSelect2Choices(props.choices) || props.options;
  }

  getField() {
    const {placeholder, disabled, clearable, name} = this.props;

    return (
      <StyledSelectControl
        creatable
        id={this.getId()}
        options={this.options}
        placeholder={placeholder}
        disabled={disabled}
        value={this.state.value}
        onChange={this.onChange}
        clearable={clearable}
        multiple={this.isMultiple()}
        name={name}
      />
    );
  }
}

// This is because we are removing `control-group` class name which provides margin-bottom
const StyledSelectControl = styled(Select)`
  ${StyledForm} &, .form-stacked & {
    .control-group & {
      margin-bottom: 0;
    }

    margin-bottom: 15px;
  }
`;

/**
 * @deprecated Do not use this
 */
export default withFormContext(SelectCreatableField);
