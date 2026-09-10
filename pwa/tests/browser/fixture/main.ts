import { mount } from 'svelte';
import '../../../src/app.css';
import Fixture from './Fixture.svelte';

mount(Fixture, { target: document.getElementById('app')! });
